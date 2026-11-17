// Work, as it is captured.
//
// A team job is one entry carrying crew = 'team', and worked_by is null because
// more than one person worked it. client_uuid is made in the browser, so an
// entry posted twice after a timeout cannot enter the hour twice.
//
// A trip is one drive, with its stops in order, and each leg goes to whoever
// caused it and records the service it bills -- never more miles than were
// driven.
import { sql, type Kysely, type SqlBool } from 'kysely';
import { recorded, versioned } from './record.ts';

export async function work(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('time_entry')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('client_uuid', 'uuid', (c) => c.notNull())
		.addColumn('worked_on', 'date', (c) => c.notNull())
		/**
		 * How long it took, in seconds: worked out by the server from the two
		 * moments, never sent. An entry recorded before it kept its times has only
		 * its length.
		 */
		.addColumn('seconds', 'integer', (c) => c.notNull().check(sql`seconds > 0`))
		/**
		 * When the work started and ended, as moments (UTC), and the zone it was
		 * done in, so it is shown as it was worked: a 9:00 job reads 9:00 to
		 * everyone. All three or none -- an entry recorded as a length alone.
		 */
		.addColumn('started_at', 'timestamptz')
		.addColumn('ended_at', 'timestamptz')
		.addColumn('zone', 'text')
		.addColumn('worked_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		.addColumn('created_by', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addColumn('entity_id', 'uuid', (c) => c.references('entity.id').onDelete('restrict'))
		.addColumn('service_id', 'uuid', (c) =>
			c.notNull().references('service.id').onDelete('restrict')
		)
		.addColumn('billable', 'boolean', (c) => c.notNull().defaultTo(true))
		.addColumn('note', 'text')
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		/**
		 * one: worked_by did it and is paid for it. team: the crew it names in
		 * time_entry_crew did it and each of them is paid, so worked_by is null.
		 */
		.addColumn('crew', sql`crew`, (c) => c.notNull())
		.addColumn('site_id', 'uuid', (c) => c.references('site.id').onDelete('restrict'))
		/**
		 * Which save of the entry this is: 1 when made, one more each time a
		 * change is saved. A change says which it began from, so the server can
		 * tell whether anyone changed it meanwhile.
		 */
		.addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
		// A phone's uuid is its maker's own: a repeat from them finds what they
		// sent, and nobody else's uuid finds it (#lib/queue).
		.addUniqueConstraint('time_entry_created_by_client_uuid_key', ['created_by', 'client_uuid'])
		.addForeignKeyConstraint('time_entry_site_is_the_clients', ['entity_id', 'site_id'], 'site', [
			'entity_id',
			'id'
		])
		.addCheckConstraint('billable_work_has_a_payer', sql`not billable or entity_id is not null`)
		.addCheckConstraint(
			'crew_says_who_worked_it',
			sql`(crew = 'one' and worked_by is not null) or (crew = 'team' and worked_by is null)`
		)
		.addCheckConstraint(
			'time_entry_times_come_together',
			sql`(started_at is null) = (ended_at is null) and (started_at is null) = (zone is null)`
		)
		.addCheckConstraint(
			'time_entry_seconds_are_its_times',
			sql`started_at is null or (ended_at > started_at and seconds = extract(epoch from ended_at - started_at))`
		)
		.execute();
	await db.schema
		.createIndex('time_entry_by_crew')
		.on('time_entry')
		.columns(['crew', 'worked_on'])
		.execute();
	await db.schema
		.createIndex('time_entry_entity')
		.on('time_entry')
		.columns(['entity_id', 'worked_on'])
		.execute();
	await db.schema.createIndex('time_entry_site').on('time_entry').column('site_id').execute();
	await db.schema
		.createIndex('time_entry_unbilled')
		.on('time_entry')
		.column('worked_on')
		.where(sql<SqlBool>`billable`)
		.execute();

	/**
	 * Who was on a team entry: each person on its crew. A one-person entry
	 * names its worker in time_entry.worked_by; a team entry names nobody there and
	 * everyone here, and is billed at the crew it names -- the first person's rate
	 * and the extra-person rate for each other -- and pays each of them.
	 */
	await db.schema
		.createTable('time_entry_crew')
		.addColumn('time_entry_id', 'uuid', (c) =>
			c.notNull().references('time_entry.id').onDelete('cascade')
		)
		.addColumn('user_id', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addPrimaryKeyConstraint('time_entry_crew_pkey', ['time_entry_id', 'user_id'])
		.execute();
	await db.schema
		.createIndex('time_entry_crew_user')
		.on('time_entry_crew')
		.column('user_id')
		.execute();

	/**
	 * What a trip is driven in, and whose it is. Its owner is who its miles
	 * pay, by the service's vehicle rule, whoever drove it; the business's -- no
	 * owner -- pays nobody. Whose it is never changes: one that changes hands is
	 * retired and added again, so trips already driven pay who they paid.
	 */
	await db.schema
		.createTable('vehicle')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('name', 'text', (c) => c.notNull())
		.addColumn('owner_id', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		/** The day it stopped being driven. It stays on the trips driven in it. */
		.addColumn('retired_on', 'date')
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint('vehicle_name_is_something', sql`btrim(name) <> ''`)
		.execute();

	await db.schema
		.createTable('trip')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('travelled_on', 'date', (c) => c.notNull())
		.addColumn('driven_by', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addColumn('created_by', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		/**
		 * What it was driven in. Null on a trip recorded before trips named
		 * their vehicle: nobody knows whose its miles were, so they pay nobody.
		 */
		.addColumn('vehicle_id', 'uuid', (c) => c.references('vehicle.id').onDelete('restrict'))
		/**
		 * Made where the trip is recorded, so a save that is sent twice is
		 * one trip. Null on a trip recorded before trips were.
		 */
		.addColumn('client_uuid', 'uuid')
		/** What it was for, kept with the trip: a mileage log asks why. */
		.addColumn('note', 'text')
		/**
		 * The odometer when it left and when it got back, if somebody read it.
		 * Both or neither; the legs are checked against what they say.
		 */
		.addColumn('odometer_start', sql`numeric(9, 1)`)
		.addColumn('odometer_end', sql`numeric(9, 1)`)
		/**
		 * Where it started and ended when that was not the base (the operator's
		 * address): null is the base.
		 */
		.addColumn('start_address', 'text')
		.addColumn('end_address', 'text')
		// The phone's uuid, unique to whoever recorded it, as for time.
		.addUniqueConstraint('trip_created_by_client_uuid_key', ['created_by', 'client_uuid'])
		.addCheckConstraint(
			'trip_odometer_reads_forward',
			sql`(odometer_start is null) = (odometer_end is null) and (odometer_start is null or (odometer_start >= 0 and odometer_end >= odometer_start))`
		)
		.addCheckConstraint(
			'trip_places_are_something',
			sql`btrim(coalesce(start_address, 'x')) <> '' and btrim(coalesce(end_address, 'x')) <> ''`
		)
		.execute();

	await db.schema
		.createTable('trip_stop')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('trip_id', 'uuid', (c) => c.notNull().references('trip.id').onDelete('cascade'))
		.addColumn('seq', 'integer', (c) => c.notNull())
		.addColumn('address', 'text')
		/** UNUSED, PLANNED. When the driver got there. Nothing records it yet. */
		.addColumn('arrived_at', 'timestamptz')
		/** UNUSED, PLANNED. When the driver left. Nothing records it yet. */
		.addColumn('departed_at', 'timestamptz')
		.addColumn('site_id', 'uuid', (c) => c.references('site.id').onDelete('set null'))
		.addUniqueConstraint('trip_stop_trip_id_seq_key', ['trip_id', 'seq'])
		// What a leg names as where it went must be a stop on its own trip.
		.addUniqueConstraint('trip_stop_trip_id_id_key', ['trip_id', 'id'])
		// A stop is a site, or an address that is nobody's site -- not both.
		.addCheckConstraint('trip_stop_is_one_place', sql`num_nonnulls(site_id, address) <= 1`)
		.execute();

	/**
	 * Who a stop was for: each client worked for there, at their own site
	 * when it is one. Two clients with sites at one address are one stop, one
	 * drive. A client who asked once the driver was there caused none of the drive
	 * and pays nothing for it. A stop for nobody -- the business's own errand --
	 * has none.
	 */
	await db.schema
		.createTable('trip_stop_client')
		.addColumn('trip_stop_id', 'uuid', (c) =>
			c.notNull().references('trip_stop.id').onDelete('cascade')
		)
		.addColumn('entity_id', 'uuid', (c) => c.notNull().references('entity.id').onDelete('restrict'))
		.addColumn('site_id', 'uuid')
		.addColumn('asked_there', 'boolean', (c) => c.notNull().defaultTo(false))
		.addPrimaryKeyConstraint('trip_stop_client_pkey', ['trip_stop_id', 'entity_id'])
		.addForeignKeyConstraint(
			'trip_stop_client_site_is_the_clients',
			['entity_id', 'site_id'],
			'site',
			['entity_id', 'id']
		)
		.execute();

	await db.schema
		.createTable('trip_leg')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('trip_id', 'uuid', (c) => c.notNull().references('trip.id').onDelete('cascade'))
		.addColumn('seq', 'integer', (c) => c.notNull())
		.addColumn('miles', sql`numeric(9, 2)`, (c) => c.notNull().check(sql`miles >= 0`))
		.addColumn('entity_id', 'uuid', (c) => c.references('entity.id').onDelete('restrict'))
		.addColumn('rule', sql`trip_leg_rule`)
		.addColumn('site_id', 'uuid', (c) => c.references('site.id').onDelete('restrict'))
		/** What this leg bills as, so nothing has to assume that only one service is charged per mile. */
		.addColumn('service_id', 'uuid', (c) => c.references('service.id').onDelete('restrict'))
		/**
		 * The stop it drove to, so a later drive between the same two places
		 * can start from these miles; null is the way back to where the trip
		 * ended. A drive shared by two clients is two legs to one stop. Null on a
		 * leg recorded before.
		 */
		.addColumn('to_stop_id', 'uuid')
		.addUniqueConstraint('trip_leg_trip_id_seq_key', ['trip_id', 'seq'])
		.addForeignKeyConstraint(
			'trip_leg_to_stop_is_the_trips',
			['trip_id', 'to_stop_id'],
			'trip_stop',
			['trip_id', 'id'],
			(f) => f.onDelete('cascade')
		)
		.addForeignKeyConstraint('trip_leg_site_is_the_clients', ['entity_id', 'site_id'], 'site', [
			'entity_id',
			'id'
		])
		.addCheckConstraint(
			'trip_leg_billed_leg_names_its_service',
			sql`entity_id is null or service_id is not null`
		)
		.execute();
	await db.schema.createIndex('trip_leg_entity').on('trip_leg').column('entity_id').execute();

	// A TIME ENTRY IS CHANGED AFTER THE FACT, UNTIL IT IS BILLED OR PAID (12 November
	// 2026). Whoever entered it, or someone with Full, changes it on its own screen
	// (#routes/api/time/[id] PATCH); each save counts (version), so a change made
	// from an old copy is told someone changed it meanwhile, and history keeps
	// every field it changed, but not the count.
	//
	// One an invoice was built from, or a payment recorded, stays as it was: the
	// invoice and the pay say what it was then, and a changed hour would leave them
	// saying something else. Removing one is already refused for the same reason
	// (invoice_line and person_payment_item reference it ON DELETE RESTRICT); this
	// refuses changing one. It is put right where it was used: taken off the
	// draft, credited on a sent invoice, or corrected on the next payment.
	await versioned(db, 'time_entry');
	await recorded(db, 'time_entry', { ignoring: ['version'], removals: true });
	await sql`
		create function a_billed_hour_stands() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF EXISTS (SELECT 1 FROM invoice_line WHERE time_entry_id = OLD.id) THEN
		    RAISE EXCEPTION 'time entry % is on an invoice, so it stays as it was billed', OLD.id
		      USING ERRCODE = 'integrity_constraint_violation';
		  END IF;
		  IF EXISTS (SELECT 1 FROM person_payment_item WHERE time_entry_id = OLD.id) THEN
		    RAISE EXCEPTION 'time entry % is in a payment, so it stays as it was paid', OLD.id
		      USING ERRCODE = 'integrity_constraint_violation';
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`create trigger a_billed_hour_stands before update on time_entry
		for each row execute function a_billed_hour_stands()`.execute(db);

	// A crew is a team entry's: one person's entry names its worker, not a crew.
	await sql`
		create function crew_is_a_teams() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF (SELECT crew FROM time_entry WHERE id = NEW.time_entry_id) IS DISTINCT FROM 'team' THEN
		    RAISE EXCEPTION 'time entry % is one person''s, so it names its worker, not a crew',
		      NEW.time_entry_id USING ERRCODE = 'integrity_constraint_violation';
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`create trigger crew_is_a_teams before insert or update on time_entry_crew
		for each row execute function crew_is_a_teams()`.execute(db);

	// And a team entry with a crew stays a team's: made one person's, it would
	// name a worker and a crew at once.
	await sql`
		create function team_keeps_its_crew() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF EXISTS (SELECT 1 FROM time_entry_crew WHERE time_entry_id = NEW.id) THEN
		    RAISE EXCEPTION 'time entry % names a crew, so it stays a team''s', NEW.id
		      USING ERRCODE = 'integrity_constraint_violation';
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`create trigger team_keeps_its_crew before update of crew on time_entry
		for each row when (new.crew is distinct from 'team')
		execute function team_keeps_its_crew()`.execute(db);

	// Who was on a team entry is part of the entry, so each person put on its
	// crew or taken off is written to the entry's own history, field "crew", in
	// the save that did it: who joined as the new value, who left as the old.
	// One taken off with the entry itself is not: the entry's deletion says that.
	await sql`
		create function record_crew() returns trigger
		language plpgsql as $function$
		DECLARE
		  who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
		  made timestamptz := nullif(current_setting('reckon.made_at', true), '')::timestamptz;
		BEGIN
		  IF TG_OP = 'INSERT' THEN
		    INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by, made_at)
		    VALUES ('time_entry', NEW.time_entry_id, 'crew', NULL, NEW.user_id::text, who, made);
		    RETURN NEW;
		  END IF;
		  -- Taken off with the entry itself: its deletion says so.
		  IF NOT EXISTS (SELECT 1 FROM time_entry WHERE id = OLD.time_entry_id) THEN
		    RETURN OLD;
		  END IF;
		  INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by, made_at)
		  VALUES ('time_entry', OLD.time_entry_id, 'crew', OLD.user_id::text, NULL, who, made);
		  RETURN OLD;
		END $function$`.execute(db);
	await sql`create trigger h_time_entry_crew after insert or delete on time_entry_crew
		for each row execute function record_crew()`.execute(db);

	// Whose a vehicle is never changes. One that changes hands is retired and added
	// again under its new owner, so the trips already driven in it pay who they paid.
	await sql`
		create function vehicle_keeps_its_owner() returns trigger
		language plpgsql as $function$
		BEGIN
		  RAISE EXCEPTION 'vehicle % is %''s: one that changes hands is retired and added again',
		    OLD.id, coalesce(OLD.owner_id::text, 'the business')
		    USING ERRCODE = 'integrity_constraint_violation';
		END $function$`.execute(db);
	await sql`create trigger vehicle_keeps_its_owner before update of owner_id on vehicle
		for each row when (old.owner_id is distinct from new.owner_id)
		execute function vehicle_keeps_its_owner()`.execute(db);

	await recorded(db, 'trip_leg');
}
