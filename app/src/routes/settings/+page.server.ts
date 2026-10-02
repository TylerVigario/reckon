import { fail } from '@sveltejs/kit';
import { and, count, eq } from 'drizzle-orm';
import { db, today } from '#lib/server/db/index.ts';
import { integration, operator, service, user } from '#lib/server/db/schema/index.ts';
import { operatorRow } from '#lib/server/operator.ts';
import { loadCatalogue } from '#lib/server/valuation/load.ts';
import { jobRate, priceOn } from '#lib/server/valuation/pricing.ts';
import type { Actions, PageServerLoad } from './$types';

const MAX_LOGO = 512 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

/**
 * The settings menu: six screens, each with the figure that answers "is this
 * set up" without opening it.
 */
export const load: PageServerLoad = async () => {
	const [row, [people], [connected], mileServices, catalogue, day] = await Promise.all([
		operatorRow(),
		db.select({ n: count() }).from(user).where(eq(user.active, true)),
		db.select({ n: count() }).from(integration).where(eq(integration.connected, true)),
		db
			.select({ id: service.id })
			.from(service)
			.where(and(eq(service.unit, 'mile'), eq(service.active, true))),
		loadCatalogue(db),
		today()
	]);
	// The mileage rate, when there is exactly one service charged by the mile.
	const mileage =
		mileServices.length === 1
			? (jobRate(priceOn(catalogue.prices, mileServices[0].id, null, day), 1)?.toString() ?? null)
			: null;

	return {
		operator: row,
		counts: { people: String(people.n), mileage, integrations: String(connected.n) }
	};
};

/**
 * The logo stays a form action. A file is not a field: there is nothing to
 * autosave until one is picked, and picking it is the whole action.
 */
export const actions: Actions = {
	logo: async ({ request }) => {
		const f = await request.formData();
		const file = f.get('logo');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { message: 'Choose an image first.' });
		if (!LOGO_TYPES.includes(file.type))
			return fail(400, {
				message: `A logo must be PNG, JPEG, SVG or WebP — that is ${file.type}.`
			});
		if (file.size > MAX_LOGO)
			return fail(400, {
				message: `A logo must be under 512 KB — that is ${Math.round(file.size / 1024)} KB.`
			});

		const bytes = Buffer.from(await file.arrayBuffer());
		const [exists] = await db.select({ id: operator.id }).from(operator).limit(1);
		if (!exists)
			return fail(400, { message: 'Set the trading name first — there is no operator yet.' });

		await db.update(operator).set({ logo: bytes, logoMediaType: file.type });
		return { saved: true };
	},

	clearLogo: async () => {
		await db.update(operator).set({ logo: null, logoMediaType: null });
		return { saved: true };
	}
};
