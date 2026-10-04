import { db } from './db/index.ts';
import { operator } from './db/schema/index.ts';
import { TAX_ROUNDING, type TaxRounding, type TaxRuleSet } from './tax-rules.ts';

/**
 * The business's own zone, locale and tax rule: its clock, how its figures read
 * -- what each person follows until they set their own (hooks.server.ts) -- and
 * how its tax is rounded (#lib/server/tax-rules).
 *
 * Read once and kept: every request asks, and they change only when the
 * business's settings are saved, which replaces them here at once. UTC, US
 * English and no tax until there is an operator.
 */
export type BusinessDefaults = { zone: string; locale: string; taxRuleSet: TaxRuleSet };

let kept: BusinessDefaults | null = null;

export async function businessDefaults(): Promise<BusinessDefaults> {
	if (kept) return kept;
	const [row] = await db
		.select({ zone: operator.timezone, locale: operator.locale, taxRuleSet: operator.taxRuleSet })
		.from(operator)
		.limit(1);
	return (kept = {
		zone: row?.zone ?? 'UTC',
		locale: row?.locale ?? 'en-US',
		taxRuleSet: row?.taxRuleSet ?? 'none'
	});
}

/** How the business's tax is rounded: its tax rule's way. */
export async function taxRounding(): Promise<TaxRounding> {
	return TAX_ROUNDING[(await businessDefaults()).taxRuleSet];
}

/** What the business's settings are from now on, as just saved. */
export async function rememberBusiness(saved: Partial<BusinessDefaults>): Promise<void> {
	kept = { ...(await businessDefaults()), ...saved };
}
