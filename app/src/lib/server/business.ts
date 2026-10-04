import { db } from './db/index.ts';
import { operator } from './db/schema/index.ts';

/**
 * The business's own zone and locale: its clock, how its figures read, and what
 * each person follows until they set their own (hooks.server.ts).
 *
 * Read once and kept: every request asks, and they change only when the
 * business's settings are saved, which replaces them here at once. UTC and US
 * English until there is an operator.
 */
export type BusinessDefaults = { zone: string; locale: string };

let kept: BusinessDefaults | null = null;

export async function businessDefaults(): Promise<BusinessDefaults> {
	if (kept) return kept;
	const [row] = await db
		.select({ zone: operator.timezone, locale: operator.locale })
		.from(operator)
		.limit(1);
	return (kept = { zone: row?.zone ?? 'UTC', locale: row?.locale ?? 'en-US' });
}

/** What the business's settings are from now on, as just saved. */
export async function rememberBusiness(saved: Partial<BusinessDefaults>): Promise<void> {
	kept = { ...(await businessDefaults()), ...saved };
}
