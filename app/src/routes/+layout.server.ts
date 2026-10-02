import { and, count, eq, gte, sql, sum } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { entity, invoice, operator, timeEntry } from '#lib/server/db/schema/index.ts';
import { iconFromLogo } from '#lib/server/app-icon.ts';
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
			has_logo: sql<boolean>`${operator.logo} is not null`,
			// Enough of the file to read a PNG's header or an SVG's root element,
			// to say whether the logo can be the installed app's icon.
			logo_head: sql<Buffer | null>`substring(${operator.logo} from 1 for 4096)`,
			logo_media_type: operator.logoMediaType
		})
		.from(operator)
		.limit(1);

	// The logo's first bytes are read only to say whether it can be the app's
	// icon; they are not sent to the browser.
	const { logo_head, logo_media_type, ...shown } = found ?? {};
	const operatorShown = found
		? {
				...shown,
				logo_is_app_icon: logo_head
					? iconFromLogo(new Uint8Array(logo_head), logo_media_type ?? null) !== null
					: false
			}
		: null;

	if (!locals.user) return { operator: operatorShown, user: null, counts: {} };

	const [[drafts], [entities], [month]] = await Promise.all([
		db.select({ n: count() }).from(invoice).where(eq(invoice.status, 'draft')),
		db.select({ n: count() }).from(entity).where(eq(entity.active, true)),
		db
			.select({ minutes: sum(timeEntry.minutes).mapWith(Number) })
			.from(timeEntry)
			.where(and(gte(timeEntry.workedOn, sql`date_trunc('month', current_date)::date`)))
	]);

	return {
		operator: operatorShown,
		user: locals.user,
		counts: { drafts: drafts.n, entities: entities.n, monthMinutes: month.minutes ?? 0 }
	};
};
