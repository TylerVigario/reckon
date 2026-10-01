import { and, count, eq, gte, sql, sum } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { entity, invoice, operator, timeEntry } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

/**
 * The operator is a singleton and everything identifying it is theirs, not
 * reckon's. Nothing reckon draws should compete with the operator's logo, and
 * everything the business is known by is set on the settings page.
 *
 * Absent, the shell says so rather than inventing a name.
 *
 * The rail carries a count beside each section. They are read here, together,
 * because the shell is drawn on every screen and a count per screen would be
 * a query per section on every navigation.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	const [found] = await db
		.select({
			trading_name: operator.tradingName,
			short_name: operator.shortName,
			accent_colour: operator.accentColour,
			currency: operator.currency,
			has_logo: sql<boolean>`${operator.logo} is not null`
		})
		.from(operator)
		.limit(1);

	if (!locals.user) return { operator: found ?? null, user: null, counts: {} };

	const [[drafts], [entities], [month]] = await Promise.all([
		db.select({ n: count() }).from(invoice).where(eq(invoice.status, 'draft')),
		db.select({ n: count() }).from(entity).where(eq(entity.active, true)),
		db
			.select({ minutes: sum(timeEntry.minutes).mapWith(Number) })
			.from(timeEntry)
			.where(and(gte(timeEntry.workedOn, sql`date_trunc('month', current_date)::date`)))
	]);

	return {
		operator: found ?? null,
		user: locals.user,
		counts: { drafts: drafts.n, entities: entities.n, monthMinutes: month.minutes ?? 0 }
	};
};
