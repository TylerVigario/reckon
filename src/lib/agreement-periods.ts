/**
 * AN AGREEMENT'S PERIODS: what each of its charges covers, and what its
 * allotment is drawn over. A period charged is written on agreement_period,
 * and that is the record: it covers what it covered when it was charged,
 * whatever the terms say now (#routes/api/agreements/[id]). A period not
 * charged yet is the one the terms give (agreement.billing_interval and
 * billing_anchor_day):
 *
 *   weekly     seven days at a time from the day it starts;
 *   monthly    from the anchor day of one month to the day before it in the
 *   quarterly  next, the third or the twelfth month on, counted from the month
 *   annually   it starts -- on the month's last day where the month is
 *              shorter, so a 31st anchor bills 28 February and 31 March;
 *
 * cut to the days the agreement runs and to the days no charged period has.
 * Days as YYYY-MM-DD, as Postgres writes them.
 */
import type { BillingInterval } from './server/db/database.ts';

export type Terms = {
	startsOn: string;
	endsOn: string | null;
	interval: BillingInterval;
	anchorDay: number;
};

export type Charged = { periodStart: string; periodEnd: string };

/** One period: its first and last day, and the charge written for it, if one is. */
export type AgreementPeriod<C extends Charged = Charged> = {
	start: string;
	end: string;
	charged: C | null;
};

/** What one period of each interval is called: "$300.00 a quarter", "used this quarter". */
export const PERIOD_WORD: Record<BillingInterval, string> = {
	weekly: 'week',
	monthly: 'month',
	quarterly: 'quarter',
	annually: 'year'
};

const MONTHS = { monthly: 1, quarterly: 3, annually: 12 } as const;

const day = (iso: string) => Temporal.PlainDate.from(iso);
const before = (iso: string) => day(iso).subtract({ days: 1 }).toString();
const after = (iso: string) => day(iso).add({ days: 1 }).toString();

/**
 * The day in `month` that an agreement anchored on `anchorDay` bills: the
 * anchor, or the month's last day when the month is shorter. Worked out fresh
 * each month, so a 31st anchor bills 28 February and 31 March, never drifting
 * onto the 28th.
 */
export function billingDate(month: string, anchorDay: number): string {
	// `with` keeps the day inside the month: the 31st of February is its last.
	return day(month).with({ day: anchorDay }).toString();
}

/** The period of the terms alone that `on` falls in, before anything cuts it. */
function ruled(t: Terms, on: string): { start: string; end: string } {
	const starts = day(t.startsOn);
	const d = day(on);
	if (t.interval === 'weekly') {
		const weeks = Math.floor(starts.until(d, { largestUnit: 'days' }).days / 7);
		const start = starts.add({ days: 7 * weeks });
		return { start: start.toString(), end: start.add({ days: 6 }).toString() };
	}
	const months = MONTHS[t.interval];
	const first = starts.with({ day: 1 });
	const bills = (k: number) =>
		billingDate(first.add({ months: k * months }).toString(), t.anchorDay);
	let k = Math.floor(((d.year - starts.year) * 12 + d.month - starts.month) / months);
	// The anchor may fall after `on` in its month: then it is the period before.
	if (on < bills(k)) k -= 1;
	return { start: bills(k), end: before(bills(k + 1)) };
}

/** The period `on` falls in, or null when the agreement is not running that day. */
export function periodOn<C extends Charged>(
	t: Terms,
	charged: readonly C[],
	on: string
): AgreementPeriod<C> | null {
	if (on < t.startsOn || (t.endsOn !== null && on > t.endsOn)) return null;
	const row = charged.find((p) => p.periodStart <= on && on <= p.periodEnd);
	if (row) return { start: row.periodStart, end: row.periodEnd, charged: row };
	let { start, end } = ruled(t, on);
	if (start < t.startsOn) start = t.startsOn;
	if (t.endsOn !== null && end > t.endsOn) end = t.endsOn;
	for (const p of charged) {
		if (p.periodEnd < on && p.periodEnd >= start) start = after(p.periodEnd);
		if (p.periodStart > on && p.periodStart <= end) end = before(p.periodStart);
	}
	return { start, end, charged: null };
}

/**
 * The period just closed on `today`: for an agreement running, the one before
 * today's; for one that has ended, its last, until the period after the one it
 * ended in would have closed too -- as long as a running one's stays the one
 * looked back on. Null when none has closed, or the last closed long since.
 */
export function lastClosed<C extends Charged>(
	t: Terms,
	charged: readonly C[],
	today: string
): AgreementPeriod<C> | null {
	const now = periodOn(t, charged, today);
	if (now) return now.start > t.startsOn ? periodOn(t, charged, before(now.start)) : null;
	if (t.endsOn === null || t.endsOn >= today) return null;
	const last = periodOn(t, charged, t.endsOn)!;
	return today <= ruled(t, after(ruled(t, last.end).end)).end ? last : null;
}
