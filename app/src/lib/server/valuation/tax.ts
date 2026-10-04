/**
 * Tax collected is owed to somebody, and the split says who: a return allocates
 * the state's share and each district's separately. Each taxable line is split
 * by what CDTFA said about its site on the day the invoice was issued -- the
 * newest answer on or before that day -- and, where nothing was asked by then,
 * by the earliest answer there is, counted as an estimate.
 */
import { Decimal, Ratio, sum } from '#lib/decimal.ts';
import { roundTax, type TaxRounding } from '../tax-rules.ts';

export type TaxLine = {
	invoiceId: string;
	amount: string;
	taxable: boolean;
	taxRatePct: string;
	siteId: string | null;
};

/** One answer CDTFA gave about a site. `checkedOn` is the day it was asked. */
export type TaxCheck = {
	siteId: string;
	checkedOn: string;
	checkedAt: Date;
	ratePct: string | null;
	statePct: string | null;
	districtPct: string | null;
	jurisdiction: string | null;
};

export type InvoiceTax = {
	invoiceId: string;
	jurisdiction: string | null;
	measure: Decimal;
	tax: Decimal;
	/** Null when no line could be split at all. */
	stateTax: Decimal | null;
	districtTax: Decimal | null;
	estimatedLines: number;
	linesWithoutASplit: number;
};

/**
 * The split for each invoice that has a taxable line. `issuedOn` is null for a
 * draft, which splits as of today. The tax is rounded as `rounding` says, the
 * business's tax rule (#lib/server/tax-rules), as every balance rounds it, and
 * every figure to the currency's `places` (#lib/currency).
 */
export function invoiceTax(
	lines: readonly TaxLine[],
	checks: readonly TaxCheck[],
	issuedOn: ReadonlyMap<string, string | null>,
	today: string,
	rounding: TaxRounding,
	places: number
): Map<string, InvoiceTax> {
	const bySite = new Map<string, TaxCheck[]>();
	for (const c of checks) {
		if (c.ratePct === null) continue;
		bySite.set(c.siteId, [...(bySite.get(c.siteId) ?? []), c]);
	}
	for (const list of bySite.values())
		list.sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());

	type Part = {
		amount: Decimal;
		rate: string;
		tax: Ratio;
		state: Ratio | null;
		district: Ratio | null;
		estimated: boolean;
		unsplit: boolean;
		jurisdiction: string | null;
	};
	const parts = new Map<string, Part[]>();
	for (const l of lines) {
		if (!l.taxable) continue;
		const asOf = issuedOn.get(l.invoiceId) ?? today;
		const list = (l.siteId && bySite.get(l.siteId)) || [];
		const inforce = [...list].reverse().find((c) => c.checkedOn <= asOf) ?? null;
		const earliest = list[0] ?? null;
		// Field by field, the answer in force and failing it the earliest.
		const pick = <K extends keyof TaxCheck>(k: K) => inforce?.[k] ?? earliest?.[k] ?? null;
		const tax = Ratio.of(l.amount).mul(l.taxRatePct).div(100);
		const rate = pick('ratePct');
		const statePct = pick('statePct');
		const districtPct = pick('districtPct');
		const splitOf = rate !== null ? Decimal.from(rate) : null;
		const can = splitOf !== null && splitOf.gt(0);
		parts.set(l.invoiceId, [
			...(parts.get(l.invoiceId) ?? []),
			{
				amount: Decimal.from(l.amount),
				rate: l.taxRatePct,
				tax,
				state: can && statePct !== null ? tax.mul(statePct).div(splitOf) : null,
				district: can && districtPct !== null ? tax.mul(districtPct).div(splitOf) : null,
				estimated: inforce === null && earliest !== null,
				unsplit: splitOf === null,
				jurisdiction: pick('jurisdiction') ?? null
			}
		]);
	}

	const out = new Map<string, InvoiceTax>();
	for (const [invoiceId, ps] of parts) {
		const add = (xs: (Ratio | null)[]) => {
			const known = xs.filter((x): x is Ratio => x !== null);
			return known.length ? known.reduce((a, b) => a.add(b)).round(places) : null;
		};
		const names = ps
			.map((p) => p.jurisdiction)
			.filter((j): j is string => j !== null)
			.sort();
		out.set(invoiceId, {
			invoiceId,
			jurisdiction: names.at(-1) ?? null,
			measure: sum(ps.map((p) => p.amount)).round(places),
			tax: roundTax(ps, rounding, places) ?? Decimal.ZERO.round(places),
			stateTax: add(ps.map((p) => p.state)),
			districtTax: add(ps.map((p) => p.district)),
			estimatedLines: ps.filter((p) => p.estimated).length,
			linesWithoutASplit: ps.filter((p) => p.unsplit).length
		});
	}
	return out;
}
