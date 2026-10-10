import { Decimal, type Ratio } from './decimal.ts';

/**
 * How a tax is rounded, and the rounding itself, where the browser can reach
 * them: a draft opened on a phone works out its tax with lines the server has
 * not seen yet, by the same rule the server does. What each rule rounds by is
 * the server's (#lib/server/tax-rules).
 */
export type TaxRounding = {
	scope: 'invoice' | 'line';
	method: 'half_up' | 'down' | 'up';
};

/**
 * The tax on a set of one invoice's lines, rounded by `rounding` to `places`:
 * each line's exact tax, with its rate. The TypeScript twin of taxSql.
 */
export function roundTax(
	lines: readonly { rate: string; tax: Ratio }[],
	rounding: TaxRounding,
	places: number
): Decimal | null {
	if (lines.length === 0) return null;
	if (rounding.scope === 'line')
		return lines
			.map((l) => l.tax.round(places, rounding.method))
			.reduce((a, b) => a.add(b).round(places));
	// By the rate itself, as the column holds it, so "7.25" and "7.2500" are one.
	const byRate = new Map<string, Ratio>();
	for (const l of lines) {
		const rate = Decimal.from(l.rate).round(4).toString();
		const had = byRate.get(rate);
		byRate.set(rate, had ? had.add(l.tax) : l.tax);
	}
	return [...byRate.values()]
		.map((t) => t.round(places, rounding.method))
		.reduce((a, b) => a.add(b).round(places));
}
