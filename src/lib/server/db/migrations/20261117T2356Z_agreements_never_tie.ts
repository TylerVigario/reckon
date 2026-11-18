// TWO AGREEMENTS NEVER TIE FOR AN HOUR (17 November 2026). An hour of a
// service is covered by an agreement of its client: one for its site before one
// for the whole client, and of those the one that started later, so a renewal
// takes over from its first day (#lib/server/valuation agreementFor). Two that
// are both for the whole client, or both for one site, and start the same day
// would leave nothing to choose between them, and which covered the hour --
// its price, its pool, what it pays -- would be whichever Postgres happened to
// return first. Such a pair is a mistake in what was entered, so the second is
// refused where it is entered: covering a service another such agreement
// covers, or moving an agreement's start onto one that does.
//
// A trigger, since the rule spans two tables. It holds the client's row while
// it looks (FOR NO KEY UPDATE, which leaves alone everything that only refers
// to the client), so two saves to one client's agreements take turns and
// neither misses what the other wrote.
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
	// A pair the rule refuses, already held, stops the migration, as adding a
	// constraint to a table holding a row it refuses would.
	await sql`
		DO $$
		BEGIN
		  IF EXISTS (
		    SELECT 1
		      FROM agreement a
		      JOIN agreement b ON b.entity_id = a.entity_id
		                      AND b.site_id IS NOT DISTINCT FROM a.site_id
		                      AND b.starts_on = a.starts_on
		                      AND b.id > a.id
		      JOIN agreement_service s ON s.agreement_id = a.id
		      JOIN agreement_service t ON t.agreement_id = b.id AND t.service_id = s.service_id
		  ) THEN
		    RAISE EXCEPTION 'two agreements of one client, for the same place and starting the same day, cover the same service: change one''s start, or stop one covering it, before this migration'
		      USING ERRCODE = 'unique_violation', CONSTRAINT = 'agreements_never_tie';
		  END IF;
		END $$`.execute(db);

	// TG_ARGV[0] names the column holding the agreement: id on agreement,
	// agreement_id on agreement_service.
	await sql`
		create function agreements_never_tie() returns trigger
		language plpgsql as $function$
		DECLARE
		  this uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
		  client uuid;
		BEGIN
		  SELECT entity_id INTO client FROM agreement WHERE id = this;
		  PERFORM 1 FROM entity WHERE id = client FOR NO KEY UPDATE;
		  IF EXISTS (
		    SELECT 1
		      FROM agreement a
		      JOIN agreement b ON b.entity_id = a.entity_id
		                      AND b.site_id IS NOT DISTINCT FROM a.site_id
		                      AND b.starts_on = a.starts_on
		                      AND b.id <> a.id
		      JOIN agreement_service s ON s.agreement_id = a.id
		      JOIN agreement_service t ON t.agreement_id = b.id AND t.service_id = s.service_id
		     WHERE a.id = this
		  ) THEN
		    RAISE EXCEPTION 'another agreement of this client, for the same place and starting the same day, covers the same service'
		      USING ERRCODE = 'unique_violation', CONSTRAINT = 'agreements_never_tie';
		  END IF;
		  RETURN NULL;
		END $function$`.execute(db);
	await sql`create trigger agreements_never_tie
		after insert or update of agreement_id, service_id on agreement_service
		for each row execute function agreements_never_tie('agreement_id')`.execute(db);
	await sql`create trigger agreements_never_tie
		after update of entity_id, site_id, starts_on on agreement
		for each row execute function agreements_never_tie('id')`.execute(db);
}
