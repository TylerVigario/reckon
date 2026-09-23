import { sql } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

/**
 * The operator is a singleton and everything identifying it is theirs, not
 * reckon's: "it should not detract from an operator supplied logo. we must
 * create a settings page so eevrything required can be operator supplied."
 *
 * Absent, the shell says so rather than inventing a name.
 *
 * The rail carries a count beside each section. They are read here, in one
 * round trip, because the shell is drawn on every screen and a count per
 * screen would be eight queries on every navigation. A count that cannot be
 * computed yet is null, and the rail shows nothing rather than a zero -- "no
 * trips" and "trips are not built" are different statements.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	const [operator] = await sql`
		select trading_name, short_name, accent_colour, currency,
		       logo is not null as has_logo
		  from operator limit 1`;

	if (!locals.user) return { operator: operator ?? null, user: null, counts: {} };

	const [counts] = await sql`
		select
		  (select count(*) from invoice where status = 'draft')                    as drafts,
		  (select count(*) from entity where active)                              as entities,
		  (select coalesce(sum(minutes), 0) from time_entry
		    where worked_on >= date_trunc('month', current_date))                  as month_minutes`;

	return {
		operator: operator ?? null,
		user: locals.user,
		counts: {
			drafts: Number(counts.drafts),
			entities: Number(counts.entities),
			monthMinutes: Number(counts.month_minutes)
		}
	};
};
