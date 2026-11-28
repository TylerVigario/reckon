// A CAP COUNTS WHAT ITS SERVICE CHARGES BY (28 November 2026, #9). A capped
// allotment was a number of hours whatever the service, but a service charged
// each bills one flat charge an entry however long it took, so hours of it say
// nothing of what it is worth. A 60-minute entry with 59 minutes left in the
// pool drew the 59 and billed its flat charge whole besides -- paid for twice
// -- and left the next entry less.
//
// So a cap is counted as its service is charged, as its price already is
// (service_price.rate, in the service's unit): hours of one charged by the
// hour or the mile, which is what a time entry measures, and of one charged
// each, how many -- every entry one, covered whole or billed whole.
// included_hours becomes included. A count is whole, and the rule spans the
// service and its allotment, so it is a trigger: a fraction is refused for a
// service charged each, and so is moving a service to each while an
// allotment of it holds one. A fraction saved holds its service's row while it
// looks, so a fraction and a move to each saved at once cannot both pass.
//
// A service charged each that is capped in hours has no count to become:
// hours of a flat charge are not a number of them. One already held stops the
// migration, as adding a constraint to a table holding a row it refuses
// would. Made unlimited, or no longer covered, it can be capped again by how
// many after.
//
// The history keeps each change under the name it was made under: one to
// included_hours before this is recorded as that.
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
	await sql`
		DO $$
		BEGIN
		  IF EXISTS (
		    SELECT 1
		      FROM agreement_service c
		      JOIN service s ON s.id = c.service_id
		     WHERE s.unit = 'each' AND c.allotment = 'capped'
		  ) THEN
		    RAISE EXCEPTION 'an agreement caps a service charged each by the hour, which has no count to become: make it unlimited, or stop covering it, before this migration'
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'a_count_is_whole';
		  END IF;
		END $$`.execute(db);

	await sql`alter table agreement_service rename column included_hours to included`.execute(db);
	await sql`alter table agreement_service
		rename constraint agreement_service_included_hours_check to agreement_service_included_check`.execute(
		db
	);

	await sql`
		create function a_count_is_whole() returns trigger
		language plpgsql as $function$
		DECLARE
		  charged_by service_unit;
		BEGIN
		  IF TG_TABLE_NAME = 'agreement_service' THEN
		    -- Held whatever it is charged by, so it cannot become one charged
		    -- each until this is saved, and then sees the fraction.
		    SELECT s.unit INTO charged_by FROM service s WHERE s.id = NEW.service_id FOR SHARE;
		    IF charged_by = 'each' THEN
		      RAISE EXCEPTION 'a service charged each is included by how many, a whole number'
		        USING ERRCODE = 'check_violation', CONSTRAINT = 'a_count_is_whole';
		    END IF;
		  ELSIF EXISTS (
		    SELECT 1 FROM agreement_service
		     WHERE service_id = NEW.id AND included <> trunc(included)
		  ) THEN
		    RAISE EXCEPTION 'an agreement includes part of an hour of this service, and charged each it would be included by how many'
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'a_count_is_whole';
		  END IF;
		  RETURN NULL;
		END $function$`.execute(db);
	await sql`create trigger a_count_is_whole
		after insert or update of included, service_id on agreement_service
		for each row when (NEW.included <> trunc(NEW.included))
		execute function a_count_is_whole()`.execute(db);
	await sql`create trigger a_count_is_whole
		after update of unit on service
		for each row when (NEW.unit = 'each' and OLD.unit <> 'each')
		execute function a_count_is_whole()`.execute(db);
}
