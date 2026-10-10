import { sql } from 'drizzle-orm';
import { db } from './db/index.ts';

/**
 * Time zones as reckon stores them: a name both Postgres and Intl know, in
 * Postgres's own spelling. Postgres turns moments into days with it and the
 * pages draw moments with it, so a name only one of them knows would fail in
 * the other.
 */

/** The canonical name for `value` from Postgres's list, if Intl knows it too; else null. */
export function pickZone(value: string, known: ReadonlyMap<string, string>): string | null {
	if (!value || value.length > 64) return null;
	const name = known.get(value.toLowerCase());
	if (!name) return null;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: name });
		return name;
	} catch {
		return null;
	}
}

let names: Promise<Map<string, string>> | null = null;
/** Postgres's zones, by lower-cased name, read once per process. */
function postgresZones(): Promise<Map<string, string>> {
	names ??= db
		.execute<{ name: string }>(sql`select name from pg_timezone_names`)
		.then((r) => new Map(r.rows.map((z) => [z.name.toLowerCase(), z.name])));
	names.catch(() => (names = null));
	return names;
}

/** A zone fit to store, in Postgres's spelling, or null if it is not one. */
export async function knownZone(value: string): Promise<string | null> {
	return pickZone(value.trim(), await postgresZones());
}
