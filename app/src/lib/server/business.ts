import { db } from './db/index.ts';
import { operator } from './db/schema/index.ts';
import { currencyPlaces } from '#lib/currency.ts';
import { TAX_ROUNDING, type TaxRounding, type TaxRuleSet } from './tax-rules.ts';

/**
 * The business's own zone, locale, currency and tax rule: its clock, how its
 * figures read -- what each person follows until they set their own
 * (hooks.server.ts) -- what its money is counted in and so to how many places
 * (#lib/currency), and how its tax is rounded (#lib/server/tax-rules).
 *
 * Read once and kept: every request asks, and they change only when the
 * business's settings are saved, which replaces them here at once. UTC, US
 * English, dollars and no tax until there is an operator.
 */
export type BusinessDefaults = {
	zone: string;
	locale: string;
	currency: string;
	taxRuleSet: TaxRuleSet;
};

let kept: BusinessDefaults | null = null;

export async function businessDefaults(): Promise<BusinessDefaults> {
	if (kept) return kept;
	const [row] = await db
		.select({
			zone: operator.timezone,
			locale: operator.locale,
			currency: operator.currency,
			taxRuleSet: operator.taxRuleSet
		})
		.from(operator)
		.limit(1);
	return (kept = {
		zone: row?.zone ?? 'UTC',
		locale: row?.locale ?? 'en-US',
		currency: row?.currency ?? 'USD',
		taxRuleSet: row?.taxRuleSet ?? 'none'
	});
}

/** How the business's tax is rounded: its tax rule's way. */
export async function taxRounding(): Promise<TaxRounding> {
	return TAX_ROUNDING[(await businessDefaults()).taxRuleSet];
}

/** How many places the business's amounts have: its currency's (#lib/currency). */
export async function moneyPlaces(): Promise<number> {
	return currencyPlaces((await businessDefaults()).currency);
}

/** What the business's settings are from now on, as just saved. */
export async function rememberBusiness(saved: Partial<BusinessDefaults>): Promise<void> {
	kept = { ...(await businessDefaults()), ...saved };
}
