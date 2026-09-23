-- reckon's schema, entire.
--
-- One file rather than twenty-two. The migrations that built this schema were
-- a conversation -- a column added, moved, renamed, and in two cases removed
-- again the same day -- and replaying that conversation is not how anybody
-- should learn what the database holds. This says what is true.
--
-- The reasoning survives in three places that are kept current: docs/decisions.md
-- holds Tyler's decisions verbatim, db/test/constraints.sql proves each rule
-- both ways, and the comments below say why a shape is the shape it is. Where a
-- choice is mine rather than his it says [claude], so the two can be told apart.
--
-- Money is NUMERIC and never a float; rates are percentages and the column names
-- say so -- rate_pct, markup_pct -- so a name carries its unit.
--
-- [claude] Value sets are CHECK constraints on text rather than enums, because
-- the tax rule set is a plugin point that will gain values and a CHECK is one
-- ALTER rather than a type migration.

BEGIN;

-- ==========================================================================
-- THE LEDGER OF WHAT HAS BEEN APPLIED
--
-- Every migration records itself here, and db/apply.sh reads it to know what a
-- database has already seen. It is first because everything else is second.

CREATE TABLE migration (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY migration
    ADD CONSTRAINT migration_pkey PRIMARY KEY (filename);

-- ==========================================================================
-- THE MACHINERY
--
-- Functions before the tables whose triggers call them.
--
-- record_change and record_deletion write history. A figure on an invoice is
-- answerable a year later -- who changed it, from what, and when -- and the answer
-- lives in record_history rather than in a backup.
--
-- freeze_sent_invoice and freeze_sent_invoice_lines make a sent invoice immutable.
-- What a client received is what the system must keep saying it received.
--
-- billing_date is the month-end rule, written once so the application and a report
-- cannot drift by each implementing it: an anchor of 31 bills the last day of a
-- short month and the 31st again the month after.

CREATE FUNCTION anchor_on_the_start_day() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.billing_anchor_day IS NULL THEN
    NEW.billing_anchor_day := EXTRACT(day FROM NEW.starts_on)::smallint;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION billing_date(in_month date, anchor_day integer) RETURNS date
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT date_trunc('month', in_month)::date
       + (LEAST(
            anchor_day,
            EXTRACT(day FROM (date_trunc('month', in_month)
                              + interval '1 month - 1 day'))::int
          ) - 1);
$$;
CREATE FUNCTION freeze_sent_invoice() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF (to_jsonb(NEW) - 'status' - 'sent_at' - 'void_reason' - 'token_expires_on')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'sent_at' - 'void_reason' - 'token_expires_on') THEN
      RAISE EXCEPTION 'invoice % is % -- only its status may change. Correct it with a credit note.',
        OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION freeze_sent_invoice_lines() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM invoice WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'invoice % is % -- its lines are immutable. Correct it with a credit note.',
      COALESCE(NEW.invoice_id, OLD.invoice_id), st
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE FUNCTION record_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  k text;
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
BEGIN
  FOR k IN SELECT jsonb_object_keys(n) LOOP
    IF o -> k IS DISTINCT FROM n -> k THEN
      INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, k, o ->> k, n ->> k, who);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE FUNCTION record_deletion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
BEGIN
  INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by)
  VALUES (TG_TABLE_NAME, OLD.id, '(deleted)', to_jsonb(OLD)::text, NULL, who);
  RETURN OLD;
END $$;

SET default_tablespace = '';

SET default_table_access_method = heap;
COMMENT ON FUNCTION billing_date(in_month date, anchor_day integer) IS 'The day a charge anchored on anchor_day falls in the month containing in_month, clamped to the last day of a month too short for it. IMMUTABLE and total: every month has a first, so every anchor has an answer.';

-- ==========================================================================
-- PEOPLE, AND HOW THEY GET IN
--
-- app_user.credential is an argon2id hash, never a password. A session is a row
-- whose key is the SHA-256 of the cookie, so the database never holds anything
-- that would let somebody sign in.

CREATE TABLE app_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    credential text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    on_team boolean DEFAULT true NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_seen_at timestamp with time zone,
    CONSTRAINT app_user_failed_attempts_check CHECK ((failed_attempts >= 0))
);
COMMENT ON COLUMN app_user.credential IS 'scrypt password hash, as N$r$p$salt$key. Never a password.';
COMMENT ON COLUMN app_user.on_team IS 'Whether this person is paid for work. A crew = ''team'' entry pays every active team member; a login that is not on the team is not one of them.';
ALTER TABLE ONLY app_user
    ADD CONSTRAINT app_user_email_key UNIQUE (email);
ALTER TABLE ONLY app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);
CREATE TABLE session (
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_used timestamp with time zone DEFAULT now() NOT NULL,
    user_agent text,
    CONSTRAINT a_session_must_end CHECK ((expires_at > created_at))
);
COMMENT ON TABLE session IS 'One row per signed-in browser. Deleting it signs that browser out; deleting a user''s rows signs them out everywhere.';
ALTER TABLE ONLY session
    ADD CONSTRAINT session_pkey PRIMARY KEY (token_hash);
CREATE INDEX session_by_user ON session USING btree (user_id);
CREATE INDEX session_expiry ON session USING btree (expires_at);

-- ==========================================================================
-- WHO IS BILLED, AND WHERE THE WORK HAPPENS
--
-- "Bravo Farms is a client, and the sites are Traver, Kettleman, etc" -- 9 Sep 2026.
--
-- A client is a business; a site is a place. Two clients can work at one address
-- and each names it their own way, which is what entity_location.label is for --
-- 36005 CA-99 N is "The Shoppe" to Bravo Farms and "Traver" to Wild Jacks.
--
-- The district is the tax-bearing thing. Reg 1826 puts district tax at the
-- jobsite, so the rate is recorded against the district and the address points at
-- it -- one row changed moves every address in that district.

CREATE TABLE entity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    terms_days integer,
    payment_method text,
    opening_balance numeric(12,2) DEFAULT 0 NOT NULL,
    tax_exempt boolean DEFAULT false NOT NULL,
    exemption_certificate text,
    exemption_expires_on date,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_terms_days_check CHECK ((terms_days >= 0)),
    CONSTRAINT exemption_needs_certificate CHECK (((NOT tax_exempt) OR (exemption_certificate IS NOT NULL)))
);
ALTER TABLE ONLY entity
    ADD CONSTRAINT entity_pkey PRIMARY KEY (id);
CREATE TRIGGER h_entity AFTER UPDATE ON entity FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE TABLE contact (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    note text
);
ALTER TABLE ONLY contact
    ADD CONSTRAINT contact_pkey PRIMARY KEY (id);
CREATE TABLE entity_contact (
    entity_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    is_primary boolean DEFAULT false NOT NULL
);
ALTER TABLE ONLY entity_contact
    ADD CONSTRAINT entity_contact_pkey PRIMARY KEY (entity_id, contact_id);
CREATE UNIQUE INDEX entity_one_primary_contact ON entity_contact USING btree (entity_id) WHERE is_primary;
CREATE TABLE location (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    street text,
    city text,
    region text,
    postcode text,
    round_trip_miles numeric(9,2),
    drive_minutes integer,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tax_district_id uuid,
    district_verified_on date,
    google_place_id text,
    address_verified_on date,
    CONSTRAINT location_drive_minutes_check CHECK ((drive_minutes >= 0)),
    CONSTRAINT location_round_trip_miles_check CHECK ((round_trip_miles >= (0)::numeric))
);
COMMENT ON COLUMN location.tax_district_id IS 'Which district this address is in. Derived from the address by a CDTFA lookup, then stored -- not re-derived per invoice. Null until looked up.';
COMMENT ON COLUMN location.district_verified_on IS 'When this address was last matched to its district by a CDTFA lookup. Null means the assignment has never been checked, only assumed.';
COMMENT ON COLUMN location.google_place_id IS 'Google''s identifier for the place this address is. Kept so the address can be re-resolved later without matching on text that may have been edited -- and it is the one piece of Places data that may be stored indefinitely.';
COMMENT ON COLUMN location.address_verified_on IS 'When the address was last confirmed against Google. Distinct from district_verified_on: one says the place is real, the other says which jurisdiction it sits in, and they are answered by different sources.';
ALTER TABLE ONLY location
    ADD CONSTRAINT location_pkey PRIMARY KEY (id);
CREATE INDEX location_tax_district ON location USING btree (tax_district_id);
CREATE TRIGGER h_location AFTER UPDATE ON location FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE TABLE entity_location (
    entity_id uuid NOT NULL,
    location_id uuid NOT NULL,
    contact_id uuid,
    label text
);
COMMENT ON TABLE entity_location IS 'Which sites are a client''s own. Not a restriction on where work may be billed: invoice 0000035 was Traver work billed through the Kettleman client.';
COMMENT ON COLUMN entity_location.contact_id IS 'Who to speak to for this client at this site. Null falls back to the client''s primary contact.';
COMMENT ON COLUMN entity_location.label IS 'What this client calls this site. Null uses the address''s own label.';
ALTER TABLE ONLY entity_location
    ADD CONSTRAINT entity_location_pkey PRIMARY KEY (entity_id, location_id);
CREATE TABLE tax_district (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    county text NOT NULL,
    active boolean DEFAULT true NOT NULL
);
COMMENT ON TABLE tax_district IS 'A CDTFA jurisdiction. Its name is theirs -- UNINCORPORATED AREA-KINGS, VISALIA -- so a lookup can be matched against what they publish.';
ALTER TABLE ONLY tax_district
    ADD CONSTRAINT tax_district_name_key UNIQUE (name);
ALTER TABLE ONLY tax_district
    ADD CONSTRAINT tax_district_pkey PRIMARY KEY (id);
CREATE TABLE tax_district_rate (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    district_id uuid NOT NULL,
    rate_pct numeric(7,4) NOT NULL,
    effective_from date NOT NULL,
    verified_on date,
    source text,
    CONSTRAINT tax_district_rate_rate_pct_check CHECK ((rate_pct >= (0)::numeric))
);
ALTER TABLE ONLY tax_district_rate
    ADD CONSTRAINT tax_district_rate_district_id_effective_from_key UNIQUE (district_id, effective_from);
ALTER TABLE ONLY tax_district_rate
    ADD CONSTRAINT tax_district_rate_pkey PRIMARY KEY (id);
CREATE INDEX tax_district_rate_asof ON tax_district_rate USING btree (district_id, effective_from DESC);
CREATE TRIGGER h_tax_district_rate AFTER UPDATE ON tax_district_rate FOR EACH ROW EXECUTE FUNCTION record_change();

-- ==========================================================================
-- WHAT CAN GO ON A LINE
--
-- "services are remote by nature not by an additional checkbox" -- 9 Sep 2026.
-- service.delivery carries it.
--
-- A price is an effective-dated row, never a column: a rate is true for a period,
-- and invoice_line stores what was billed rather than looking it up, or changing a
-- price silently rewrites history. The most specific row wins --
-- (service, entity?, crew?) -- and person_pay_rate answers the same question for
-- pay, including per person since both partners being on one rate is a fact about
-- today rather than about the design.

CREATE TABLE service (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    taxable boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    delivery text,
    time_tracked boolean DEFAULT true NOT NULL,
    subscription_hours numeric(8,2),
    subscription_overage text,
    subscription_basis text DEFAULT 'none'::text NOT NULL,
    subscription_period text,
    CONSTRAINT service_delivery_check CHECK ((delivery = ANY (ARRAY['on_site'::text, 'remote'::text]))),
    CONSTRAINT service_subscription_basis_check CHECK ((subscription_basis = ANY (ARRAY['none'::text, 'capped'::text, 'unlimited'::text]))),
    CONSTRAINT service_subscription_hours_check CHECK ((subscription_hours >= (0)::numeric)),
    CONSTRAINT service_subscription_overage_check CHECK ((subscription_overage = ANY (ARRAY['bill'::text, 'no_charge'::text, 'deny'::text]))),
    CONSTRAINT service_subscription_period_check CHECK ((subscription_period = ANY (ARRAY['week'::text, 'month'::text, 'quarter'::text, 'year'::text]))),
    CONSTRAINT service_unit_check CHECK ((unit = ANY (ARRAY['hour'::text, 'mile'::text]))),
    CONSTRAINT subscription_terms_match_basis CHECK ((((subscription_basis = 'none'::text) AND (subscription_hours IS NULL) AND (subscription_overage IS NULL) AND (subscription_period IS NULL)) OR ((subscription_basis = 'capped'::text) AND (subscription_hours IS NOT NULL) AND (subscription_overage IS NOT NULL) AND (subscription_period IS NOT NULL)) OR ((subscription_basis = 'unlimited'::text) AND (subscription_hours IS NULL) AND (subscription_overage IS NULL) AND (subscription_period IS NULL))))
);
COMMENT ON COLUMN service.delivery IS 'on_site, remote, or null where the service is not attendance at all. Remote services draw the remote allotment.';
COMMENT ON COLUMN service.time_tracked IS 'Whether this service appears in the timer. Independent of unit: a service charged per mile may still be worth timing.';
COMMENT ON COLUMN service.subscription_hours IS 'Hours a subscription to this service includes, when the agreement does not say otherwise. NULL means this service is not sold as a subscription -- which is NOT what NULL means on agreement.remote_cap_hours, where it means unlimited.';
COMMENT ON COLUMN service.subscription_overage IS 'What happens once the included hours are used, when the agreement does not say otherwise. Set if and only if subscription_hours is.';
COMMENT ON COLUMN service.subscription_basis IS 'Whether this service is sold as a subscription, and what the allotment is: none (not subscribed), capped (subscription_hours a period, subscription_overage past them) or unlimited.';
COMMENT ON COLUMN service.subscription_period IS 'What the allotment refreshes over. Four hours a month and four hours a week are different products, and subscription_hours alone cannot tell them apart.';
ALTER TABLE ONLY service
    ADD CONSTRAINT service_code_key UNIQUE (code);
ALTER TABLE ONLY service
    ADD CONSTRAINT service_pkey PRIMARY KEY (id);
CREATE INDEX service_delivery ON service USING btree (delivery) WHERE (delivery IS NOT NULL);
CREATE INDEX service_time_tracked ON service USING btree (time_tracked) WHERE time_tracked;
CREATE TABLE service_price (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    entity_id uuid,
    crew text,
    rate numeric(12,2) NOT NULL,
    effective_from date NOT NULL,
    CONSTRAINT service_price_crew_check CHECK ((crew = ANY (ARRAY['one'::text, 'team'::text]))),
    CONSTRAINT service_price_rate_check CHECK ((rate >= (0)::numeric))
);
ALTER TABLE ONLY service_price
    ADD CONSTRAINT service_price_pkey PRIMARY KEY (id);
ALTER TABLE ONLY service_price
    ADD CONSTRAINT service_price_service_id_entity_id_crew_effective_from_key UNIQUE NULLS NOT DISTINCT (service_id, entity_id, crew, effective_from);
CREATE INDEX service_price_asof ON service_price USING btree (service_id, effective_from DESC);
CREATE TRIGGER h_service_price AFTER UPDATE ON service_price FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE TABLE person_pay_rate (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid,
    rate numeric(12,2) NOT NULL,
    effective_from date NOT NULL,
    user_id uuid,
    CONSTRAINT person_pay_rate_rate_check CHECK ((rate >= (0)::numeric))
);
COMMENT ON COLUMN person_pay_rate.user_id IS 'Who this rate pays. NULL means everyone, which is what both partners are on today. A rate for one person beats a rate for everyone, the same way a rate for one service beats a rate for any.';
ALTER TABLE ONLY person_pay_rate
    ADD CONSTRAINT person_pay_rate_pkey PRIMARY KEY (id);
ALTER TABLE ONLY person_pay_rate
    ADD CONSTRAINT person_pay_rate_scope UNIQUE NULLS NOT DISTINCT (user_id, service_id, effective_from);
CREATE TRIGGER h_person_pay_rate AFTER UPDATE ON person_pay_rate FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE TABLE material (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku text,
    name text NOT NULL,
    brand text,
    unit text NOT NULL,
    markup_pct numeric(7,4),
    taxable boolean DEFAULT true NOT NULL,
    reorder_level numeric(12,4),
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT material_markup_pct_check CHECK ((markup_pct >= (0)::numeric)),
    CONSTRAINT material_reorder_level_check CHECK ((reorder_level >= (0)::numeric)),
    CONSTRAINT material_unit_check CHECK ((unit = ANY (ARRAY['each'::text, 'foot'::text])))
);
COMMENT ON COLUMN material.markup_pct IS 'Null takes operator.default_markup_pct. Set it here to override one item.';
ALTER TABLE ONLY material
    ADD CONSTRAINT material_pkey PRIMARY KEY (id);
ALTER TABLE ONLY material
    ADD CONSTRAINT material_sku_key UNIQUE (sku);
CREATE TABLE material_price (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    price numeric(12,4) NOT NULL,
    effective_from date NOT NULL,
    CONSTRAINT material_price_price_check CHECK ((price >= (0)::numeric))
);
ALTER TABLE ONLY material_price
    ADD CONSTRAINT material_price_material_id_effective_from_key UNIQUE (material_id, effective_from);
ALTER TABLE ONLY material_price
    ADD CONSTRAINT material_price_pkey PRIMARY KEY (id);
CREATE TABLE material_lot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    received_on date NOT NULL,
    supplier text,
    document_ref text,
    qty_received numeric(12,4) NOT NULL,
    qty_remaining numeric(12,4) NOT NULL,
    ex_tax_cost_per_unit numeric(12,4) NOT NULL,
    tax_paid_per_unit numeric(12,4) DEFAULT 0 NOT NULL,
    CONSTRAINT cannot_use_more_than_received CHECK ((qty_remaining <= qty_received)),
    CONSTRAINT material_lot_ex_tax_cost_per_unit_check CHECK ((ex_tax_cost_per_unit >= (0)::numeric)),
    CONSTRAINT material_lot_qty_received_check CHECK ((qty_received > (0)::numeric)),
    CONSTRAINT material_lot_qty_remaining_check CHECK ((qty_remaining >= (0)::numeric)),
    CONSTRAINT material_lot_tax_paid_per_unit_check CHECK ((tax_paid_per_unit >= (0)::numeric))
);
ALTER TABLE ONLY material_lot
    ADD CONSTRAINT material_lot_pkey PRIMARY KEY (id);
CREATE INDEX material_lot_open ON material_lot USING btree (material_id, received_on) WHERE (qty_remaining > (0)::numeric);
CREATE TRIGGER h_material_lot AFTER UPDATE ON material_lot FOR EACH ROW EXECUTE FUNCTION record_change();

-- ==========================================================================
-- WORK, AS IT IS CAPTURED
--
-- "wouldnt it just be simpler to log hours as both which get split at partner pay
-- out time?" -- 9 Sep 2026. A team job is one entry carrying crew = 'team', and
-- worked_by is null because both worked it.
--
-- client_uuid is made in the browser, so an entry posted twice after a timeout
-- cannot enter the hour twice.

CREATE TABLE time_entry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_uuid uuid NOT NULL,
    worked_on date NOT NULL,
    minutes integer NOT NULL,
    worked_by uuid,
    created_by uuid NOT NULL,
    entity_id uuid,
    location_id uuid,
    service_id uuid NOT NULL,
    billable boolean DEFAULT true NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    crew text NOT NULL,
    CONSTRAINT billable_work_has_a_payer CHECK (((NOT billable) OR (entity_id IS NOT NULL))),
    CONSTRAINT crew_says_who_worked_it CHECK ((((crew = 'one'::text) AND (worked_by IS NOT NULL)) OR ((crew = 'team'::text) AND (worked_by IS NULL)))),
    CONSTRAINT time_entry_crew_check CHECK ((crew = ANY (ARRAY['one'::text, 'team'::text]))),
    CONSTRAINT time_entry_minutes_check CHECK ((minutes > 0))
);
COMMENT ON COLUMN time_entry.crew IS 'one: worked_by did it and is paid for it. team: the team did it and every active team member is paid, so worked_by is null.';
ALTER TABLE ONLY time_entry
    ADD CONSTRAINT time_entry_client_uuid_key UNIQUE (client_uuid);
ALTER TABLE ONLY time_entry
    ADD CONSTRAINT time_entry_pkey PRIMARY KEY (id);
CREATE INDEX time_entry_crew ON time_entry USING btree (crew, worked_on);
CREATE INDEX time_entry_entity ON time_entry USING btree (entity_id, worked_on);
CREATE INDEX time_entry_unbilled ON time_entry USING btree (worked_on) WHERE billable;
CREATE TRIGGER d_time_entry AFTER DELETE ON time_entry FOR EACH ROW EXECUTE FUNCTION record_deletion();
CREATE TRIGGER h_time_entry AFTER UPDATE ON time_entry FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE TABLE trip (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    travelled_on date NOT NULL,
    driven_by uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY trip
    ADD CONSTRAINT trip_pkey PRIMARY KEY (id);
CREATE TABLE trip_stop (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid NOT NULL,
    seq integer NOT NULL,
    location_id uuid,
    address text,
    arrived_at timestamp with time zone,
    departed_at timestamp with time zone
);
ALTER TABLE ONLY trip_stop
    ADD CONSTRAINT trip_stop_pkey PRIMARY KEY (id);
ALTER TABLE ONLY trip_stop
    ADD CONSTRAINT trip_stop_trip_id_seq_key UNIQUE (trip_id, seq);
CREATE TABLE trip_leg (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid NOT NULL,
    seq integer NOT NULL,
    miles numeric(9,2) NOT NULL,
    entity_id uuid,
    location_id uuid,
    rule text,
    CONSTRAINT trip_leg_miles_check CHECK ((miles >= (0)::numeric)),
    CONSTRAINT trip_leg_rule_check CHECK ((rule = ANY (ARRAY['house_to_a'::text, 'a_to_b'::text, 'b_to_house'::text, 'round_trip'::text, 'split'::text, 'unassigned'::text])))
);
ALTER TABLE ONLY trip_leg
    ADD CONSTRAINT trip_leg_pkey PRIMARY KEY (id);
ALTER TABLE ONLY trip_leg
    ADD CONSTRAINT trip_leg_trip_id_seq_key UNIQUE (trip_id, seq);
CREATE INDEX trip_leg_entity ON trip_leg USING btree (entity_id);
CREATE TRIGGER h_trip_leg AFTER UPDATE ON trip_leg FOR EACH ROW EXECUTE FUNCTION record_change();

-- ==========================================================================
-- STANDING ARRANGEMENTS
--
-- An agreement bills on its own anniversary, not the calendar's: billing_anchor_day
-- comes off starts_on and is then left alone. Every period is whole by
-- construction, so the only partial one is a final period the agreement did not
-- finish.
--
-- An allotment says what it is -- none, capped or unlimited -- rather than saying
-- it by leaving a column empty, because an empty cap meant "unlimited" here and
-- "not sold as a subscription" one table over.

CREATE TABLE agreement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    basis text NOT NULL,
    price numeric(12,2) NOT NULL,
    remote_cap_hours numeric(8,2),
    responder_rate numeric(12,2),
    overage text DEFAULT 'bill'::text NOT NULL,
    starts_on date NOT NULL,
    ends_on date,
    allotment_basis text,
    remote_allotment text DEFAULT 'none'::text NOT NULL,
    contact_id uuid,
    billing_interval text DEFAULT 'monthly'::text NOT NULL,
    billing_anchor_day smallint NOT NULL,
    final_period_proration text DEFAULT 'daily'::text NOT NULL,
    CONSTRAINT agreement_allotment_basis_check CHECK ((allotment_basis = ANY (ARRAY['flat'::text, 'per_location'::text]))),
    CONSTRAINT agreement_basis_check CHECK ((basis = ANY (ARRAY['flat'::text, 'per_location'::text]))),
    CONSTRAINT agreement_billing_anchor_day_check CHECK (((billing_anchor_day >= 1) AND (billing_anchor_day <= 31))),
    CONSTRAINT agreement_billing_interval_check CHECK ((billing_interval = ANY (ARRAY['weekly'::text, 'monthly'::text, 'quarterly'::text, 'annually'::text]))),
    CONSTRAINT agreement_ends_after_it_starts CHECK (((ends_on IS NULL) OR (ends_on >= starts_on))),
    CONSTRAINT agreement_final_period_proration_check CHECK ((final_period_proration = ANY (ARRAY['none'::text, 'daily'::text]))),
    CONSTRAINT agreement_overage_check CHECK ((overage = ANY (ARRAY['bill'::text, 'no_charge'::text, 'deny'::text]))),
    CONSTRAINT agreement_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT agreement_remote_allotment_check CHECK ((remote_allotment = ANY (ARRAY['none'::text, 'capped'::text, 'unlimited'::text]))),
    CONSTRAINT agreement_remote_cap_hours_check CHECK ((remote_cap_hours >= (0)::numeric)),
    CONSTRAINT agreement_responder_rate_check CHECK ((responder_rate >= (0)::numeric)),
    CONSTRAINT remote_allotment_matches_the_cap CHECK ((((remote_allotment = 'capped'::text) AND (remote_cap_hours IS NOT NULL)) OR ((remote_allotment <> 'capped'::text) AND (remote_cap_hours IS NULL))))
);
COMMENT ON COLUMN agreement.allotment_basis IS 'How the pre-paid hours are granted, which need not match how the money is charged: per_location multiplies by the sites covered, flat grants once. Null follows basis.';
COMMENT ON COLUMN agreement.remote_allotment IS 'What this agreement includes: none, capped (remote_cap_hours a period, multiplied by allotment_basis) or unlimited. NULL hours no longer carry that meaning on their own.';
COMMENT ON COLUMN agreement.contact_id IS 'The person this was agreed with. A retainer is agreed with somebody by name, and when it is questioned a year later that name is the answer. ON DELETE SET NULL: losing the contact must not lose the agreement.';
COMMENT ON COLUMN agreement.billing_interval IS 'How often it bills. The period it covers is agreement_period; this is the rule that generates one.';
COMMENT ON COLUMN agreement.billing_anchor_day IS 'The day of the month this bills on, taken from starts_on and then left alone. Kept as a number rather than read back off the last invoice: a 31st anchor bills 28 February and must still bill 31 March.';
COMMENT ON COLUMN agreement.final_period_proration IS 'What happens to a period this agreement did not finish. daily: the client is billed the days they had. none: the last period bills whole, whenever it ended. Only ever applies to the period containing ends_on -- every other period is whole, because billing is anchored to starts_on.';
ALTER TABLE ONLY agreement
    ADD CONSTRAINT agreement_pkey PRIMARY KEY (id);
CREATE TRIGGER agreement_anchor BEFORE INSERT ON agreement FOR EACH ROW EXECUTE FUNCTION anchor_on_the_start_day();
CREATE TRIGGER h_agreement AFTER UPDATE ON agreement FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE TABLE agreement_location (
    agreement_id uuid NOT NULL,
    location_id uuid NOT NULL
);
ALTER TABLE ONLY agreement_location
    ADD CONSTRAINT agreement_location_pkey PRIMARY KEY (agreement_id, location_id);
CREATE TABLE agreement_period (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agreement_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    amount numeric(12,2) NOT NULL,
    CONSTRAINT agreement_period_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT period_ends_after_it_starts CHECK ((period_end >= period_start))
);
ALTER TABLE ONLY agreement_period
    ADD CONSTRAINT agreement_period_agreement_id_period_start_key UNIQUE (agreement_id, period_start);
ALTER TABLE ONLY agreement_period
    ADD CONSTRAINT agreement_period_pkey PRIMARY KEY (id);

-- ==========================================================================
-- INVOICING
--
-- A sent invoice is frozen by trigger, not by convention. Tax is stored per line
-- with the rate that was applied and where it came from, so a return can be
-- recomputed from the invoice rather than from today's rate table.

CREATE TABLE invoice (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text NOT NULL,
    entity_id uuid NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    issued_on date,
    due_on date,
    period_start date,
    period_end date,
    public_token text,
    token_expires_on date,
    sent_at timestamp with time zone,
    created_by uuid NOT NULL,
    void_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'paid'::text, 'void'::text]))),
    CONSTRAINT sent_invoices_have_dates CHECK (((status = 'draft'::text) OR ((issued_on IS NOT NULL) AND (due_on IS NOT NULL)))),
    CONSTRAINT voiding_needs_a_reason CHECK (((status <> 'void'::text) OR (void_reason IS NOT NULL)))
);
ALTER TABLE ONLY invoice
    ADD CONSTRAINT invoice_number_key UNIQUE (number);
ALTER TABLE ONLY invoice
    ADD CONSTRAINT invoice_pkey PRIMARY KEY (id);
ALTER TABLE ONLY invoice
    ADD CONSTRAINT invoice_public_token_key UNIQUE (public_token);
CREATE INDEX invoice_entity_status ON invoice USING btree (entity_id, status);
CREATE TRIGGER freeze_invoice BEFORE UPDATE ON invoice FOR EACH ROW EXECUTE FUNCTION freeze_sent_invoice();
CREATE TRIGGER h_invoice AFTER UPDATE ON invoice FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE TABLE invoice_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    seq integer NOT NULL,
    kind text NOT NULL,
    description text NOT NULL,
    qty numeric(12,4) NOT NULL,
    unit_price numeric(12,4) NOT NULL,
    location_id uuid,
    taxable boolean DEFAULT false NOT NULL,
    tax_rate_pct numeric(7,4) DEFAULT 0 NOT NULL,
    tax_source text DEFAULT 'none'::text NOT NULL,
    tax_override_reason text,
    ex_tax_cost numeric(12,4),
    tax_paid numeric(12,4),
    amount numeric(12,2) NOT NULL,
    time_entry_id uuid,
    trip_leg_id uuid,
    agreement_period_id uuid,
    material_lot_id uuid,
    unit text,
    CONSTRAINT invoice_line_kind_check CHECK ((kind = ANY (ARRAY['service'::text, 'material'::text, 'recurring'::text, 'adjustment'::text]))),
    CONSTRAINT invoice_line_tax_rate_pct_check CHECK ((tax_rate_pct >= (0)::numeric)),
    CONSTRAINT invoice_line_tax_source_check CHECK ((tax_source = ANY (ARRAY['none'::text, 'site'::text, 'override'::text, 'exempt'::text]))),
    CONSTRAINT invoice_line_unit_check CHECK ((unit = ANY (ARRAY['hour'::text, 'mile'::text, 'each'::text, 'foot'::text, 'month'::text]))),
    CONSTRAINT one_source_at_most CHECK (((((((time_entry_id IS NOT NULL))::integer + ((trip_leg_id IS NOT NULL))::integer) + ((agreement_period_id IS NOT NULL))::integer) + ((material_lot_id IS NOT NULL))::integer) <= 1)),
    CONSTRAINT override_needs_a_reason CHECK (((tax_source <> 'override'::text) OR (tax_override_reason IS NOT NULL))),
    CONSTRAINT untaxed_lines_carry_no_rate CHECK ((taxable OR (tax_rate_pct = (0)::numeric)))
);
COMMENT ON COLUMN invoice_line.unit IS 'What qty counts, frozen at issue. Null where the quantity names nothing -- a flat charge or an adjustment.';
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_agreement_period_id_key UNIQUE (agreement_period_id);
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_invoice_id_seq_key UNIQUE (invoice_id, seq);
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_pkey PRIMARY KEY (id);
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_time_entry_id_key UNIQUE (time_entry_id);
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_trip_leg_id_key UNIQUE (trip_leg_id);
CREATE INDEX invoice_line_location ON invoice_line USING btree (location_id);
CREATE INDEX invoice_line_material ON invoice_line USING btree (material_lot_id);
CREATE TRIGGER freeze_lines BEFORE INSERT OR DELETE OR UPDATE ON invoice_line FOR EACH ROW EXECUTE FUNCTION freeze_sent_invoice_lines();
CREATE TABLE credit_note (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text NOT NULL,
    entity_id uuid NOT NULL,
    issued_on date NOT NULL,
    amount numeric(12,2) NOT NULL,
    kind text NOT NULL,
    reason text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_note_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT credit_note_kind_check CHECK ((kind = ANY (ARRAY['reg1700b'::text, 'correction'::text, 'goodwill'::text])))
);
ALTER TABLE ONLY credit_note
    ADD CONSTRAINT credit_note_number_key UNIQUE (number);
ALTER TABLE ONLY credit_note
    ADD CONSTRAINT credit_note_pkey PRIMARY KEY (id);
CREATE TABLE credit_application (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    credit_note_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    applied_on date NOT NULL,
    CONSTRAINT credit_application_amount_check CHECK ((amount > (0)::numeric))
);
ALTER TABLE ONLY credit_application
    ADD CONSTRAINT credit_application_credit_note_id_invoice_id_key UNIQUE (credit_note_id, invoice_id);
ALTER TABLE ONLY credit_application
    ADD CONSTRAINT credit_application_pkey PRIMARY KEY (id);

-- ==========================================================================
-- MONEY COMING BACK
--
-- A payout nets out: gross less fees equals net, checked. Processor fees are a
-- cost of collecting, and the ledger wants them separated from the payment.

CREATE TABLE payment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    received_on date NOT NULL,
    gross numeric(12,2) NOT NULL,
    method text NOT NULL,
    processor_ref text,
    payout_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_gross_check CHECK ((gross > (0)::numeric)),
    CONSTRAINT payment_method_check CHECK ((method = ANY (ARRAY['card'::text, 'transfer'::text, 'cheque'::text, 'cash'::text, 'other'::text])))
);
ALTER TABLE ONLY payment
    ADD CONSTRAINT payment_pkey PRIMARY KEY (id);
CREATE INDEX payment_entity ON payment USING btree (entity_id, received_on);
CREATE INDEX payment_payout ON payment USING btree (payout_id);
CREATE TABLE payment_allocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    CONSTRAINT payment_allocation_amount_check CHECK ((amount > (0)::numeric))
);
ALTER TABLE ONLY payment_allocation
    ADD CONSTRAINT payment_allocation_payment_id_invoice_id_key UNIQUE (payment_id, invoice_id);
ALTER TABLE ONLY payment_allocation
    ADD CONSTRAINT payment_allocation_pkey PRIMARY KEY (id);
CREATE TABLE payout (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    processor text NOT NULL,
    arrived_on date NOT NULL,
    gross numeric(12,2) NOT NULL,
    fees numeric(12,2) DEFAULT 0 NOT NULL,
    net numeric(12,2) NOT NULL,
    bank_reference text,
    CONSTRAINT payout_nets_out CHECK ((net = (gross - fees)))
);
ALTER TABLE ONLY payout
    ADD CONSTRAINT payout_pkey PRIMARY KEY (id);
CREATE TABLE refund (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    refunded_on date NOT NULL,
    reason text NOT NULL,
    CONSTRAINT refund_amount_check CHECK ((amount > (0)::numeric))
);
ALTER TABLE ONLY refund
    ADD CONSTRAINT refund_pkey PRIMARY KEY (id);

-- ==========================================================================
-- THE OPERATOR, AND THE RECORD
--
-- "it should not detract from an operator supplied logo. we must create a settings
-- page so eevrything required can be operator supplied" -- 3 Sep 2026. Everything
-- identifying the business is the operator's to set and reckon assumes none of it.
--
-- integration records whether an outside thing is wired up and what it points at,
-- never how to log in: keys are environment, because a table travels in every dump
-- and every backup.

CREATE TABLE operator (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trading_name text NOT NULL,
    short_name text,
    logo bytea,
    logo_media_type text,
    accent_colour text,
    address text,
    tax_number text,
    tax_number_label text DEFAULT 'EIN'::text NOT NULL,
    email text,
    phone text,
    currency text DEFAULT 'USD'::text NOT NULL,
    timezone text DEFAULT 'America/Los_Angeles'::text NOT NULL,
    rounding_mode text DEFAULT 'half_up'::text NOT NULL,
    tax_rule_set text DEFAULT 'none'::text NOT NULL,
    invoice_number_format text DEFAULT '0000000'::text NOT NULL,
    next_invoice_number integer DEFAULT 1 NOT NULL,
    default_terms_days integer DEFAULT 14 NOT NULL,
    ageing_alert_days integer DEFAULT 21 NOT NULL,
    base_location_id uuid,
    singleton boolean DEFAULT true NOT NULL,
    default_markup_pct numeric(7,4) DEFAULT 20 NOT NULL,
    google_place_id text,
    address_verified_on date,
    invoice_footer text,
    email_attaches_pdf boolean DEFAULT true NOT NULL,
    email_includes_payment_link boolean DEFAULT true NOT NULL,
    auto_send boolean DEFAULT false NOT NULL,
    tax_registration text,
    tax_agency text,
    filing_basis text,
    fiscal_year_end_month smallint,
    claims_tax_paid_purchases_resold boolean DEFAULT false NOT NULL,
    date_format text DEFAULT 'd MMM yyyy'::text NOT NULL,
    mileage_assignment text DEFAULT 'actual'::text NOT NULL,
    CONSTRAINT operator_ageing_alert_days_check CHECK ((ageing_alert_days > 0)),
    CONSTRAINT operator_default_markup_pct_check CHECK ((default_markup_pct >= (0)::numeric)),
    CONSTRAINT operator_default_terms_days_check CHECK ((default_terms_days >= 0)),
    CONSTRAINT operator_filing_basis_check CHECK ((filing_basis = ANY (ARRAY['annual'::text, 'quarterly'::text, 'monthly'::text]))),
    CONSTRAINT operator_fiscal_year_end_month_check CHECK (((fiscal_year_end_month >= 1) AND (fiscal_year_end_month <= 12))),
    CONSTRAINT operator_mileage_assignment_check CHECK ((mileage_assignment = ANY (ARRAY['actual'::text, 'round_trip_per_client'::text]))),
    CONSTRAINT operator_next_invoice_number_check CHECK ((next_invoice_number > 0)),
    CONSTRAINT operator_rounding_mode_check CHECK ((rounding_mode = ANY (ARRAY['half_up'::text, 'half_even'::text]))),
    CONSTRAINT operator_singleton_check CHECK (singleton),
    CONSTRAINT operator_tax_rule_set_check CHECK ((tax_rule_set = ANY (ARRAY['us_ca'::text, 'flat_per_site'::text, 'none'::text])))
);
COMMENT ON COLUMN operator.google_place_id IS 'Google''s identifier for the place operator.address is. Same meaning as location.google_place_id, and the same licence position: the id is the one piece of Places data that may be stored indefinitely.';
COMMENT ON COLUMN operator.address_verified_on IS 'When operator.address was last confirmed against Google.';
COMMENT ON COLUMN operator.invoice_footer IS 'Printed on every invoice, under the lines. Where "cheques payable to" and how card payments settle belong.';
COMMENT ON COLUMN operator.auto_send IS 'Whether a built draft goes out on its own. False by default and deliberately so: a draft is built overnight, and a person decides it is right before a client ever sees it.';
COMMENT ON COLUMN operator.tax_registration IS 'What the operator holds, in the issuer''s own words -- "Seller''s permit". Distinct from tax_number, which is the number on it.';
COMMENT ON COLUMN operator.tax_agency IS 'Who issued it and who the return goes to -- CDTFA in California.';
COMMENT ON COLUMN operator.fiscal_year_end_month IS 'The month the fiscal year ends in; the year ends on its last day. Reports are built on this -- a Schedule A for FY2026-27 cannot be drawn without it.';
COMMENT ON COLUMN operator.claims_tax_paid_purchases_resold IS 'The Reg 1701 election: tax already paid on materials that were resold comes off the measure. An election, not a calculation, so it is recorded rather than inferred from whether any material qualifies.';
COMMENT ON COLUMN operator.date_format IS 'How a date is written on screen and in print. Stored as a pattern rather than a locale name: "3 Sep 2026" is a choice about this business''s documents, not about the reader''s browser.';
COMMENT ON COLUMN operator.mileage_assignment IS 'actual: each leg goes to whoever caused it, and never more miles than were driven. round_trip_per_client: a full round trip each, which is what most systems do and which over-bills whenever two sites are near each other -- at Kettleman it charges 144 miles for 72.2 driven.';
ALTER TABLE ONLY operator
    ADD CONSTRAINT operator_pkey PRIMARY KEY (id);
ALTER TABLE ONLY operator
    ADD CONSTRAINT operator_singleton_key UNIQUE (singleton);
CREATE TRIGGER h_operator AFTER UPDATE ON operator FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE TABLE integration (
    name text NOT NULL,
    connected boolean DEFAULT false NOT NULL,
    detail text,
    checked_at timestamp with time zone,
    CONSTRAINT integration_name_check CHECK ((name = ANY (ARRAY['stripe'::text, 'beancount'::text, 'press'::text, 'email'::text])))
);
COMMENT ON TABLE integration IS 'Whether an outside thing is wired up, and what it points at -- the ledger directory, the sending address. NEVER a credential: keys and passwords are environment, because a table travels in every dump and every backup.';
COMMENT ON COLUMN integration.detail IS 'What it points at, in the operator''s terms: "books/" for the ledger, the from-address for email. Not a secret.';
COMMENT ON COLUMN integration.checked_at IS 'When the connection was last proven, rather than last configured. A key that was right in March says nothing about today.';
ALTER TABLE ONLY integration
    ADD CONSTRAINT integration_pkey PRIMARY KEY (name);
CREATE TABLE account_map (
    role text NOT NULL,
    account text NOT NULL
);
ALTER TABLE ONLY account_map
    ADD CONSTRAINT account_map_pkey PRIMARY KEY (role);
CREATE TABLE ledger_export (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event text NOT NULL,
    source_table text NOT NULL,
    source_id uuid NOT NULL,
    dated_on date NOT NULL,
    exported_at timestamp with time zone DEFAULT now() NOT NULL,
    transaction_text text NOT NULL
);
ALTER TABLE ONLY ledger_export
    ADD CONSTRAINT ledger_export_pkey PRIMARY KEY (id);
ALTER TABLE ONLY ledger_export
    ADD CONSTRAINT ledger_export_source_table_source_id_event_key UNIQUE (source_table, source_id, event);
CREATE TABLE record_history (
    id bigint NOT NULL,
    table_name text NOT NULL,
    row_id uuid NOT NULL,
    field text NOT NULL,
    old_value text,
    new_value text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE record_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE record_history_id_seq OWNED BY record_history.id;
ALTER TABLE ONLY record_history ALTER COLUMN id SET DEFAULT nextval('record_history_id_seq'::regclass);
ALTER TABLE ONLY record_history
    ADD CONSTRAINT record_history_pkey PRIMARY KEY (id);
CREATE INDEX record_history_row ON record_history USING btree (table_name, row_id, changed_at DESC);

-- ==========================================================================
-- THE QUESTIONS WORTH ASKING OFTEN
--
-- A view is a question, not a cache. client_site names a site the way its own
-- client names it; site_rate resolves an address to the rate in force through
-- its district; agreement_allotment says what an agreement includes and
-- agreement_period_usage how much of it is left. Usage is derived from the
-- entries themselves -- no counter is stored, because a counter and the entries
-- it counts eventually disagree.

CREATE VIEW agreement_allotment AS
 SELECT id AS agreement_id,
    entity_id,
    basis,
    remote_allotment,
    overage,
    remote_cap_hours,
        CASE
            WHEN (remote_allotment <> 'capped'::text) THEN NULL::numeric
            WHEN (COALESCE(allotment_basis, basis) = 'per_location'::text) THEN (remote_cap_hours * (( SELECT count(*) AS count
               FROM agreement_location al
              WHERE (al.agreement_id = a.id)))::numeric)
            ELSE remote_cap_hours
        END AS pooled_hours
   FROM agreement a;
CREATE VIEW agreement_period_usage AS
 SELECT p.id AS agreement_period_id,
    p.agreement_id,
    p.period_start,
    p.period_end,
    al.remote_allotment,
    al.pooled_hours,
    ((COALESCE(sum(t.minutes) FILTER (WHERE (t.id IS NOT NULL)), (0)::bigint))::numeric / 60.0) AS hours_used,
        CASE
            WHEN (al.pooled_hours IS NULL) THEN NULL::numeric
            ELSE GREATEST((al.pooled_hours - ((COALESCE(sum(t.minutes) FILTER (WHERE (t.id IS NOT NULL)), (0)::bigint))::numeric / 60.0)), (0)::numeric)
        END AS hours_left
   FROM (((agreement_period p
     JOIN agreement a ON ((a.id = p.agreement_id)))
     JOIN agreement_allotment al ON ((al.agreement_id = a.id)))
     LEFT JOIN time_entry t ON (((t.entity_id = a.entity_id) AND (t.worked_on >= p.period_start) AND (t.worked_on <= p.period_end) AND t.billable AND (t.service_id IN ( SELECT service.id
           FROM service
          WHERE (service.delivery = 'remote'::text))))))
  GROUP BY p.id, p.agreement_id, p.period_start, p.period_end, al.remote_allotment, al.pooled_hours;
CREATE VIEW client_site AS
 SELECT el.entity_id,
    el.location_id,
    COALESCE(el.label, l.label) AS label,
    COALESCE(el.contact_id, ec.contact_id) AS contact_id,
    (el.label IS NOT NULL) AS is_own_label,
    (el.contact_id IS NOT NULL) AS is_own_contact,
        CASE
            WHEN ((l.city IS NULL) OR (l.city = ''::text)) THEN COALESCE(el.label, l.label)
            WHEN ((lower(COALESCE(el.label, l.label)) ~~ (('%'::text || lower(l.city)) || '%'::text)) OR (lower(l.city) ~~ (('%'::text || lower(COALESCE(el.label, l.label))) || '%'::text))) THEN COALESCE(el.label, l.label)
            ELSE ((COALESCE(el.label, l.label) || ', '::text) || l.city)
        END AS display
   FROM ((entity_location el
     JOIN location l ON ((l.id = el.location_id)))
     LEFT JOIN entity_contact ec ON (((ec.entity_id = el.entity_id) AND ec.is_primary)));
CREATE VIEW site_rate AS
 SELECT l.id AS location_id,
    d.id AS district_id,
    d.name AS district,
    r.rate_pct,
    r.effective_from
   FROM ((location l
     JOIN tax_district d ON ((d.id = l.tax_district_id)))
     JOIN LATERAL ( SELECT tax_district_rate.rate_pct,
            tax_district_rate.effective_from
           FROM tax_district_rate
          WHERE ((tax_district_rate.district_id = d.id) AND (tax_district_rate.effective_from <= CURRENT_DATE))
          ORDER BY tax_district_rate.effective_from DESC
         LIMIT 1) r ON (true));
COMMENT ON VIEW agreement_allotment IS 'What an agreement includes for a period. pooled_hours is null when the allotment is not capped -- read remote_allotment to know whether that is unlimited or nothing at all.';
COMMENT ON VIEW agreement_period_usage IS 'Hours used against an agreement in one period, and how many are left. hours_left is null when there is no cap -- remote_allotment says whether that is unlimited or nothing included at all. Usage is derived from the entries themselves; no counter is stored.';
COMMENT ON VIEW client_site IS 'One row per site a client has: their name for it, their contact, and a display that says where it is. Each falls back where they have none.';
COMMENT ON VIEW site_rate IS 'Today''s district rate for each site that has one. A site with no district, or a district with no rate yet in force, has no row -- it must refuse.';

-- ==========================================================================
-- WHAT POINTS AT WHAT
--
-- Foreign keys together at the end, because a key cannot be added before both
-- of its tables exist and scattering them would force the tables into an order
-- chosen by the constraints rather than by the reader.
--
-- The ON DELETE clauses are the interesting part and they are not uniform:
-- RESTRICT where losing the parent would lose money owed or hours worked,
-- CASCADE where the child is meaningless alone, SET NULL where the child
-- outlives the parent -- an agreement survives the contact it was agreed with.

ALTER TABLE ONLY agreement
    ADD CONSTRAINT agreement_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contact(id) ON DELETE SET NULL;
ALTER TABLE ONLY agreement
    ADD CONSTRAINT agreement_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE RESTRICT;
ALTER TABLE ONLY agreement_location
    ADD CONSTRAINT agreement_location_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES agreement(id) ON DELETE CASCADE;
ALTER TABLE ONLY agreement_location
    ADD CONSTRAINT agreement_location_location_id_fkey FOREIGN KEY (location_id) REFERENCES location(id) ON DELETE RESTRICT;
ALTER TABLE ONLY agreement_period
    ADD CONSTRAINT agreement_period_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES agreement(id) ON DELETE RESTRICT;
ALTER TABLE ONLY credit_application
    ADD CONSTRAINT credit_application_credit_note_id_fkey FOREIGN KEY (credit_note_id) REFERENCES credit_note(id) ON DELETE RESTRICT;
ALTER TABLE ONLY credit_application
    ADD CONSTRAINT credit_application_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoice(id) ON DELETE RESTRICT;
ALTER TABLE ONLY credit_note
    ADD CONSTRAINT credit_note_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id) ON DELETE RESTRICT;
ALTER TABLE ONLY credit_note
    ADD CONSTRAINT credit_note_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE RESTRICT;
ALTER TABLE ONLY entity_contact
    ADD CONSTRAINT entity_contact_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contact(id) ON DELETE CASCADE;
ALTER TABLE ONLY entity_contact
    ADD CONSTRAINT entity_contact_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE;
ALTER TABLE ONLY entity_location
    ADD CONSTRAINT entity_location_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contact(id) ON DELETE SET NULL;
ALTER TABLE ONLY entity_location
    ADD CONSTRAINT entity_location_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE;
ALTER TABLE ONLY entity_location
    ADD CONSTRAINT entity_location_location_id_fkey FOREIGN KEY (location_id) REFERENCES location(id) ON DELETE CASCADE;
ALTER TABLE ONLY invoice
    ADD CONSTRAINT invoice_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id) ON DELETE RESTRICT;
ALTER TABLE ONLY invoice
    ADD CONSTRAINT invoice_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE RESTRICT;
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_agreement_period_id_fkey FOREIGN KEY (agreement_period_id) REFERENCES agreement_period(id) ON DELETE RESTRICT;
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoice(id) ON DELETE CASCADE;
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_location_id_fkey FOREIGN KEY (location_id) REFERENCES location(id) ON DELETE RESTRICT;
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_material_lot_id_fkey FOREIGN KEY (material_lot_id) REFERENCES material_lot(id) ON DELETE RESTRICT;
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_time_entry_id_fkey FOREIGN KEY (time_entry_id) REFERENCES time_entry(id) ON DELETE RESTRICT;
ALTER TABLE ONLY invoice_line
    ADD CONSTRAINT invoice_line_trip_leg_id_fkey FOREIGN KEY (trip_leg_id) REFERENCES trip_leg(id) ON DELETE RESTRICT;
ALTER TABLE ONLY location
    ADD CONSTRAINT location_tax_district_id_fkey FOREIGN KEY (tax_district_id) REFERENCES tax_district(id) ON DELETE RESTRICT;
ALTER TABLE ONLY material_lot
    ADD CONSTRAINT material_lot_material_id_fkey FOREIGN KEY (material_id) REFERENCES material(id) ON DELETE RESTRICT;
ALTER TABLE ONLY material_price
    ADD CONSTRAINT material_price_material_id_fkey FOREIGN KEY (material_id) REFERENCES material(id) ON DELETE CASCADE;
ALTER TABLE ONLY operator
    ADD CONSTRAINT operator_base_location_id_fkey FOREIGN KEY (base_location_id) REFERENCES location(id) ON DELETE SET NULL;
ALTER TABLE ONLY payment_allocation
    ADD CONSTRAINT payment_allocation_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoice(id) ON DELETE RESTRICT;
ALTER TABLE ONLY payment_allocation
    ADD CONSTRAINT payment_allocation_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payment(id) ON DELETE CASCADE;
ALTER TABLE ONLY payment
    ADD CONSTRAINT payment_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE RESTRICT;
ALTER TABLE ONLY payment
    ADD CONSTRAINT payment_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES payout(id) ON DELETE SET NULL;
ALTER TABLE ONLY person_pay_rate
    ADD CONSTRAINT person_pay_rate_service_id_fkey FOREIGN KEY (service_id) REFERENCES service(id) ON DELETE CASCADE;
ALTER TABLE ONLY person_pay_rate
    ADD CONSTRAINT person_pay_rate_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE ONLY record_history
    ADD CONSTRAINT record_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE ONLY refund
    ADD CONSTRAINT refund_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payment(id) ON DELETE RESTRICT;
ALTER TABLE ONLY service_price
    ADD CONSTRAINT service_price_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE;
ALTER TABLE ONLY service_price
    ADD CONSTRAINT service_price_service_id_fkey FOREIGN KEY (service_id) REFERENCES service(id) ON DELETE CASCADE;
ALTER TABLE ONLY session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE ONLY tax_district_rate
    ADD CONSTRAINT tax_district_rate_district_id_fkey FOREIGN KEY (district_id) REFERENCES tax_district(id) ON DELETE CASCADE;
ALTER TABLE ONLY time_entry
    ADD CONSTRAINT time_entry_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id) ON DELETE RESTRICT;
ALTER TABLE ONLY time_entry
    ADD CONSTRAINT time_entry_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE RESTRICT;
ALTER TABLE ONLY time_entry
    ADD CONSTRAINT time_entry_location_id_fkey FOREIGN KEY (location_id) REFERENCES location(id) ON DELETE RESTRICT;
ALTER TABLE ONLY time_entry
    ADD CONSTRAINT time_entry_service_id_fkey FOREIGN KEY (service_id) REFERENCES service(id) ON DELETE RESTRICT;
ALTER TABLE ONLY time_entry
    ADD CONSTRAINT time_entry_worked_by_fkey FOREIGN KEY (worked_by) REFERENCES app_user(id) ON DELETE RESTRICT;
ALTER TABLE ONLY trip
    ADD CONSTRAINT trip_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id) ON DELETE RESTRICT;
ALTER TABLE ONLY trip
    ADD CONSTRAINT trip_driven_by_fkey FOREIGN KEY (driven_by) REFERENCES app_user(id) ON DELETE RESTRICT;
ALTER TABLE ONLY trip_leg
    ADD CONSTRAINT trip_leg_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE RESTRICT;
ALTER TABLE ONLY trip_leg
    ADD CONSTRAINT trip_leg_location_id_fkey FOREIGN KEY (location_id) REFERENCES location(id) ON DELETE RESTRICT;
ALTER TABLE ONLY trip_leg
    ADD CONSTRAINT trip_leg_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trip(id) ON DELETE CASCADE;
ALTER TABLE ONLY trip_stop
    ADD CONSTRAINT trip_stop_location_id_fkey FOREIGN KEY (location_id) REFERENCES location(id) ON DELETE RESTRICT;
ALTER TABLE ONLY trip_stop
    ADD CONSTRAINT trip_stop_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trip(id) ON DELETE CASCADE;

--
-- PostgreSQL database dump complete
--


INSERT INTO migration (filename) VALUES ('0001_the_schema.sql');

COMMIT;
