/**
 * How a pay rule is said, in one place: what it pays for, and how much.
 *
 * The services screen and a service's history both print rules, and a rule
 * worded one way in one and another in the other is two answers to one
 * question.
 */
import { pct } from './format';

export const PAYS_FOR = {
	time: 'for their time',
	covered_time: 'for time a retainer covers',
	vehicle: 'for their vehicle'
} as const;

/**
 * "$25.00 an hour", "0% of the retainer", "nothing" -- as a figure and its unit.
 * `money` is the caller's, so a component passes the one that knows the
 * operator's currency.
 */
export function paysWhat(
	r: { pays_for: string; method: string; amount: string | null },
	money: (v: string | null) => string
): { v: string; x: string } {
	switch (r.method) {
		case 'per_hour':
			return { v: money(r.amount), x: 'an hour' };
		case 'percent':
			return {
				v: pct(r.amount, 0),
				x: r.pays_for === 'covered_time' ? 'of the retainer' : 'of the line'
			};
		case 'fixed':
			return { v: money(r.amount), x: 'an entry' };
		default:
			return { v: 'nothing', x: '' };
	}
}
