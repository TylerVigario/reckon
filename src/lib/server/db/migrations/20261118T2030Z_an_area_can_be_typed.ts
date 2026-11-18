// A PERSON CAN TYPE A TAX AREA (18 November 2026). CDTFA answers for an
// address in California; in most states nothing does, and a business that
// collects in Nevada types Nevada's areas in from the Department of Taxation's
// own table. Where an area's pieces come from is its source, and a person
// typing them is one more.
//
// On its own, because a word added to a type "cannot be used until after the
// transaction has been committed" (PostgreSQL 18, ALTER TYPE), and the
// migration after this one uses it.
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
	await sql`alter type tax_area_source add value 'typed'`.execute(db);
}
