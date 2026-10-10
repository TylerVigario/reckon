/**
 * The business's currency, and what follows from it: how many places its
 * amounts have.
 *
 * PLACES ARE THE CURRENCY'S. A dollar has cents, a yen has none, a Kuwaiti
 * dinar has fils, which are thousandths. Every amount reckon works out -- a
 * line, a total, a share of a retainer, someone's pay -- is rounded half up to
 * its currency's places, and money is stored at them. How a tax rounds is the
 * tax's own rule (#lib/server/tax-rules), but it rounds to these places too.
 *
 * Intl says how many: CLDR's figure, which is also how Intl writes an amount,
 * so what is stored and what is shown are the same number. An amount never
 * reads as ¥1,235 while it is 1234.56.
 *
 * A money column holds three places, the most any currency Intl knows has, and
 * the currency setting accepts only a currency Intl knows.
 *
 * WHERE IT COMES FROM is set once by each side, as the reader's locale is
 * (#lib/format): the request in hand on the server, the page's data in the
 * browser. Everything else here is Intl, the same on both.
 */
import { Decimal } from './decimal.ts';

let currencyOf: () => string = () => 'USD';

/** Where the business's currency comes from, set by hooks.server.ts and hooks.client.ts. */
export function readCurrencyFrom(source: () => string): void {
	currencyOf = source;
}

/** The business's currency, by its ISO 4217 code. */
export function currency(): string {
	return currencyOf();
}

/**
 * What a money column holds: ten whole digits, and three places -- enough for
 * every currency Intl knows (#lib/server/db/schema/columns).
 */
export const MONEY_WHOLE = 10;
export const MONEY_SCALE = 3;

const placesOf = new Map<string, number>();

/** How many places a currency's amounts have: USD 2, JPY 0, KWD 3. The business's, by default. */
export function currencyPlaces(code: string = currencyOf()): number {
	let places = placesOf.get(code);
	if (places === undefined)
		placesOf.set(
			code,
			(places =
				new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
					.maximumFractionDigits ?? 2)
		);
	return places;
}

/** Whether Intl knows this currency: "USD" does, "XYZ" does not. */
export function isCurrency(code: string): boolean {
	return Intl.supportedValuesOf('currency').includes(code);
}

/**
 * A stored amount as a field shows it to be edited: to the currency's places,
 * "95.000" as "95.00" in dollars and "95" in yen. A place the currency does not
 * have is never hidden -- "95.125" stays as it is, for the field to refuse
 * until it is put right.
 */
export function forInput(v: string | null | undefined, places = currencyPlaces()): string {
	if (v === null || v === undefined || v === '') return '';
	const d = Decimal.from(v);
	const at = d.round(places);
	return at.eq(d) ? at.toString() : d.toString().replace(/0+$/, '');
}
