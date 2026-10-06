import { Decimal, Ratio, sum } from './decimal.ts';
import { roundTax, type TaxRounding } from './tax-rounding.ts';

/** A line as a total sees it: what kind, what it comes to, and the rate on it. */
export type Totalled = { kind: string; amount: string; taxable: boolean; rate: string };

/**
 * What a draft comes to, worked out on the phone: the server's lines and the
 * ones waiting on this phone together, taxed by the rounding the server's own
 * lines were (#lib/tax-rounding). A line from stock is costed when it arrives,
 * so with one on the phone this is what the draft will come to as near as the
 * phone can say.
 */
export function draftTotals(lines: readonly Totalled[], rounding: TaxRounding, places: number) {
	const taxed = lines.filter((l) => l.taxable);
	const untaxed = sum(lines.filter((l) => !l.taxable).map((l) => l.amount));
	const measure = sum(taxed.map((l) => l.amount));
	const tax =
		roundTax(
			taxed.map((l) => ({ rate: l.rate, tax: Ratio.of(l.amount).mul(l.rate).div(100) })),
			rounding,
			places
		) ?? Decimal.ZERO;
	return {
		untaxed: untaxed.toFixed(places),
		tax: tax.toFixed(places),
		due: untaxed.add(measure).add(tax).toFixed(places),
		untaxed_kinds: [...new Set(lines.filter((l) => !l.taxable).map((l) => l.kind))],
		taxed_kinds: [...new Set(taxed.map((l) => l.kind))]
	};
}
