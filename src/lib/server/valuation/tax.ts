/**
 * Tax collected is owed to somebody, and who levied it says who: a return
 * allocates each jurisdiction's piece separately. Each taxable line's tax is
 * split by the pieces it kept when it was added (invoice_line.tax_pieces), so
 * the split is always of the tax actually charged. Only a line taxed at its
 * site's rate keeps pieces; tax charged at any other is in what was charged,
 * levied by nobody it can name.
 */
import { Decimal, Ratio, sum } from '#lib/decimal.ts';
import type { TaxLevel } from '../db/database.ts';
import type { TaxPiece } from '../db/tax-pieces.ts';
import { roundTax, type TaxRounding } from '../tax-rules.ts';

export type TaxLine = {
	invoiceId: string;
	amount: string;
	taxable: boolean;
	taxRatePct: string;
	/** Where it was taxed, as the line kept it. */
	jurisdiction: string | null;
	/** Who levied what of its rate, as the line kept it. */
	pieces: TaxPiece[] | null;
};

/** What one jurisdiction levied, at one level. */
export type Levied = { level: TaxLevel; jurisdiction: string; tax: Decimal };

export type InvoiceTax = {
	invoiceId: string;
	jurisdiction: string | null;
	measure: Decimal;
	tax: Decimal;
	/** Who levied it: federal, then state, then local, each by name. */
	levied: Levied[];
};

const LEVELS: readonly TaxLevel[] = ['federal', 'state', 'local'];

/** Pieces in the order a return lists them: by level, then by name. */
export const inLevelOrder = <T extends { level: TaxLevel; jurisdiction: string }>(a: T, b: T) =>
	LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.jurisdiction.localeCompare(b.jurisdiction);

/**
 * The tax of each invoice that has a taxable line, and who levied it. The tax
 * is rounded as `rounding` says, sales tax's rule
 * (#lib/server/tax-rules), as every balance rounds it, and every figure to the
 * currency's `places` (#lib/currency).
 */
export function invoiceTax(
	lines: readonly TaxLine[],
	rounding: TaxRounding,
	places: number
): Map<string, InvoiceTax> {
	type Part = { amount: Decimal; rate: string; tax: Ratio; jurisdiction: string | null };
	const parts = new Map<string, Part[]>();
	type Piece = { level: TaxLevel; jurisdiction: string; tax: Ratio };
	const by = new Map<string, Map<string, Piece>>();
	for (const l of lines) {
		if (!l.taxable) continue;
		const tax = Ratio.of(l.amount).mul(l.taxRatePct).div(100);
		parts.set(l.invoiceId, [
			...(parts.get(l.invoiceId) ?? []),
			{ amount: Decimal.from(l.amount), rate: l.taxRatePct, tax, jurisdiction: l.jurisdiction }
		]);
		// The pieces add up to the rate (line_pieces_are_its_rate), so each
		// piece's part of the tax is its part of the rate. A rate of nothing is
		// nothing levied by anyone.
		const rate = Decimal.from(l.taxRatePct);
		if (l.pieces === null || rate.isZero()) continue;
		const levied = by.get(l.invoiceId) ?? new Map<string, Piece>();
		for (const p of l.pieces) {
			const key = `${p.level} ${p.jurisdiction}`;
			const was = levied.get(key);
			const part = tax.mul(p.rate).div(rate);
			levied.set(key, {
				level: p.level,
				jurisdiction: p.jurisdiction,
				tax: was ? was.tax.add(part) : part
			});
		}
		by.set(l.invoiceId, levied);
	}

	const out = new Map<string, InvoiceTax>();
	for (const [invoiceId, ps] of parts) {
		const names = ps
			.map((p) => p.jurisdiction)
			.filter((j): j is string => j !== null)
			.sort();
		out.set(invoiceId, {
			invoiceId,
			jurisdiction: names.at(-1) ?? null,
			measure: sum(ps.map((p) => p.amount)).round(places),
			tax: roundTax(ps, rounding, places) ?? Decimal.ZERO.round(places),
			levied: [...(by.get(invoiceId)?.values() ?? [])]
				.map((x) => ({ ...x, tax: x.tax.round(places) }))
				.sort(inLevelOrder)
		});
	}
	return out;
}
