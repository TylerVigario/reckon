import { db } from './db/index.ts';
import { currencyPlaces } from '#lib/currency.ts';

/**
 * The business's own zone, locale and currency: its clock, how its figures
 * read -- what each person follows until they set their own (hooks.server.ts)
 * -- and what its money is counted in and so to how many places
 * (#lib/currency).
 *
 * Read once and kept: every request asks, and they change only when the
 * business's settings are saved, which replaces them here at once. UTC, US
 * English and dollars until there is an operator.
 */
export type BusinessDefaults = {
	zone: string;
	locale: string;
	currency: string;
};

let kept: BusinessDefaults | null = null;

export async function businessDefaults(): Promise<BusinessDefaults> {
	if (kept) return kept;
	const row = await db
		.selectFrom('operator')
		.select(['timezone as zone', 'locale', 'currency'])
		.limit(1)
		.executeTakeFirst();
	return (kept = {
		zone: row?.zone ?? 'UTC',
		locale: row?.locale ?? 'en-US',
		currency: row?.currency ?? 'USD'
	});
}

/** How many places the business's amounts have: its currency's (#lib/currency). */
export async function moneyPlaces(): Promise<number> {
	return currencyPlaces((await businessDefaults()).currency);
}

/** What the business's settings are from now on, as just saved. */
export async function rememberBusiness(saved: Partial<BusinessDefaults>): Promise<void> {
	kept = { ...(await businessDefaults()), ...saved };
}
