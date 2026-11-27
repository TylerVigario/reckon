/**
 * A STATE'S FILING PERIODS, as often as its registration says the business
 * files there (tax_registration.filing_basis): each calendar month, each
 * calendar quarter, or each filing year, ending in the month the business's
 * year does (operator.fiscal_year_end_month) -- December where it has not
 * said, California's yearly; June, its fiscal yearly. A return or a payment is
 * for one of them (#lib/server/sales-tax). Days as YYYY-MM-DD, as a date input
 * sends them and Postgres writes them.
 */
import type { FilingBasis } from './server/db/database.ts';
import { monthOf, span } from './format.ts';

export type FilingPeriod = { start: string; end: string };

const MONTHS: Record<FilingBasis, number> = { monthly: 1, quarterly: 3, annual: 12 };

const day = (iso: string) => Temporal.PlainDate.from(iso);

/** The period `on` falls in. */
export function periodOf(
	on: string,
	basis: FilingBasis,
	yearEndMonth: number | null
): FilingPeriod {
	const months = MONTHS[basis];
	const d = day(on);
	// Periods are counted from the month after the year ends: January, where it
	// ends in December, or for a quarter, any quarter's first month.
	const first = basis === 'annual' ? ((yearEndMonth ?? 12) % 12) + 1 : 1;
	const into = (((d.month - first) % months) + months) % months;
	const start = d.with({ day: 1 }).subtract({ months: into });
	return { start: start.toString(), end: start.add({ months }).subtract({ days: 1 }).toString() };
}

/**
 * The `count` periods before the one `today` falls in, the latest first: the
 * periods a return can be filed for. With `current`, the one it falls in
 * first, as a prepayment is for.
 */
export function periodsTo(
	today: string,
	basis: FilingBasis,
	yearEndMonth: number | null,
	count: number,
	current = false
): FilingPeriod[] {
	const now = periodOf(today, basis, yearEndMonth);
	const out: FilingPeriod[] = current ? [now] : [];
	let end = day(now.start).subtract({ days: 1 });
	for (let i = 0; i < count; i++) {
		const p = periodOf(end.toString(), basis, yearEndMonth);
		out.push(p);
		end = day(p.start).subtract({ days: 1 });
	}
	return out;
}

/** "September 2026" for a calendar month, and otherwise its days: "1 Jul – 30 Sept 2026". */
export function periodSaid(p: FilingPeriod): string {
	const start = day(p.start);
	const whole =
		start.day === 1 && start.add({ months: 1 }).subtract({ days: 1 }).equals(day(p.end));
	return whole ? monthOf(p.start) : span(p.start, p.end);
}

/** A period as a key: its first and last day. */
export const periodKey = (p: FilingPeriod) => `${p.start}/${p.end}`;
