import { sql } from 'kysely';
import { businessToday } from '#lib/server/calendar.ts';
import { db } from '#lib/server/db/index.ts';
import { iconFromLogo } from '#lib/server/app-icon.ts';
import { fieldOnly, theirWork } from '#lib/server/mine.ts';
import { isOfflineCopy } from '#lib/offline-copy.ts';
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
 * a query per section on every navigation. A copy kept for no signal has none
 * (#lib/offline-copy): a count from whenever it was kept would be read as now.
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const found = await db
		.selectFrom('operator')
		.select((eb) => [
			'trading_name',
			'short_name',
			'accent_colour',
			'currency',
			sql<boolean>`${eb.ref('logo')} is not null`.as('has_logo'),
			// Enough of the file to read a PNG's header or an SVG's root element,
			// to say whether the logo can be the installed app's icon.
			sql<Buffer | null>`substring(${eb.ref('logo')} from 1 for 4096)`.as('logo_head'),
			'logo_media_type'
		])
		.limit(1)
		.executeTakeFirst();

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

	// The person's zone and locale go with every page, so what the browser
	// draws matches what the server drew (#lib/zone.svelte, hooks.client.ts).
	if (!locals.user)
		return {
			operator: operatorShown,
			user: null,
			counts: {},
			zone: locals.zone,
			locale: locals.locale
		};
	if (isOfflineCopy(url))
		return {
			operator: operatorShown,
			user: locals.user,
			zone: locals.zone,
			locale: locals.locale,
			theme: locals.theme,
			counts: {}
		};

	const userId = locals.user.id;
	const [drafts, entities, month] = await Promise.all([
		db
			.selectFrom('invoice')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('status', '=', 'draft')
			.executeTakeFirstOrThrow(),
		db
			.selectFrom('entity')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('active', '=', true)
			.executeTakeFirstOrThrow(),
		db
			.selectFrom('time_entry')
			.select((eb) =>
				eb.cast<number | null>(eb.fn.sum('time_entry.seconds'), 'integer').as('seconds')
			)
			.where(
				'time_entry.worked_on',
				'>=',
				sql<string>`date_trunc('month', ${businessToday()}::date)::date`
			)
			// Someone with Field counts their own month (#lib/access).
			.$if(fieldOnly(locals), (qb) => qb.where((eb) => theirWork(eb, userId)))
			.executeTakeFirstOrThrow()
	]);

	return {
		operator: operatorShown,
		user: locals.user,
		zone: locals.zone,
		locale: locals.locale,
		theme: locals.theme,
		counts: { drafts: drafts.n, entities: entities.n, monthSeconds: month.seconds ?? 0 }
	};
};
