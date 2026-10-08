/**
 * How a pay rule is said, in one place: what it pays for, and how much.
 *
 * The services screen and a service's history both print rules, and a rule
 * worded one way in one and another in the other is two answers to one
 * question.
 */
import { percent } from './format.ts';

export const PAYS_FOR = {
	time: 'for their time',
	covered_time: 'for time a retainer covers',
	vehicle: 'for their vehicle'
} as const;

/**
 * "$22.00 an hour", "12% of the retainer", "$5.00 a leg", "nothing" -- as a
 * figure and its unit.
 * An hourly rate is a price, written as finely as it is held; a fixed sum is an
 * amount. `money` and `unitPrice` are the caller's, so a component passes the
 * ones that know the operator's currency.
 */
export function paysWhat(
	r: { pays_for: string; method: string; amount: string | null },
	{ money, unitPrice }: Record<'money' | 'unitPrice', (v: string | null) => string>
): { v: string; x: string } {
	switch (r.method) {
		case 'per_hour':
			return { v: unitPrice(r.amount), x: 'an hour' };
		case 'percent':
			return {
				v: percent(r.amount),
				x: r.pays_for === 'covered_time' ? 'of the retainer' : 'of the line'
			};
		case 'fixed':
			return { v: money(r.amount), x: r.pays_for === 'vehicle' ? 'a leg' : 'an entry' };
		default:
			return { v: 'nothing', x: '' };
	}
}

/**
 * What a vehicle's miles pay, said under it: its owner by the vehicle rule on
 * each service charged by the mile -- "Its miles pay Avery Lind 90% of the line
 * on Travel." -- or nobody for the business's own.
 */
export function vehicleWords(
	owner: string | null,
	terms: readonly {
		service: string;
		rule: { pays_for: string; method: string; amount: string | null } | null;
	}[],
	words: Record<'money' | 'unitPrice', (v: string | null) => string>
): string {
	if (owner === null)
		return 'Its miles pay nobody, whoever drives it: the business keeps what they bill.';
	if (!terms.length) return 'Nothing is charged by the mile yet.';
	const paid = terms.filter((t) => t.rule !== null);
	if (!paid.length)
		return `No vehicle rule on ${terms.map((t) => t.service).join(' or ')} reaches ${owner} yet.`;
	const each = paid.map((t) => {
		const w = paysWhat(t.rule!, words);
		return [w.v, w.x, `on ${t.service}`].filter(Boolean).join(' ');
	});
	return `Its miles pay ${owner} ${each.join('; ')}.`;
}

/**
 * What a person's pay is (0027), as every screen says it: the role that is
 * paid it, what the money is called, and the heading over it. A trip pays back
 * the vehicle's owner whatever their role, so a reimbursement has no role.
 */
export const PAID_AS_WORDS = {
	guaranteed_payment: {
		role: 'Partner',
		people: 'Partners',
		money: 'guaranteed payments',
		heading: 'Guaranteed payments'
	},
	wages: { role: 'Employee', people: 'Employees', money: 'wages', heading: 'Wages' },
	fee: { role: 'Contractor', people: 'Contractors', money: 'fees', heading: 'Fees' },
	reimbursement: { role: null, people: null, money: 'reimbursed', heading: 'For the vehicle' }
} as const;

export type PaidAs = keyof typeof PAID_AS_WORDS;

/** The order they are listed in: pay first, by role, then what is paid back. */
export const PAID_AS_ORDER: readonly PaidAs[] = [
	'guaranteed_payment',
	'wages',
	'fee',
	'reimbursement'
];

/** "Partner — guaranteed payments": what a role is paid as, where it is chosen. */
export const paysAsLabel = (k: Exclude<PaidAs, 'reimbursement'>) =>
	`${PAID_AS_WORDS[k].role} — ${PAID_AS_WORDS[k].money}`;
