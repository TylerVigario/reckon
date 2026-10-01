import { Decimal, Ratio } from '$lib/decimal';

export type PayRule = {
	serviceId: string;
	roleId: string | null;
	userId: string | null;
	entityId: string | null;
	paysFor: 'time' | 'covered_time' | 'vehicle';
	method: 'per_hour' | 'percent' | 'fixed' | 'nothing';
	amount: string | null;
	effectiveFrom: string;
};

/** Who is being paid: the person, and the capacity they hold now. */
export type Payee = { id: string; roleId: string | null };

/**
 * The rule that pays this person for this service, for this client, on this
 * day. A client's own rule beats every client's; then a person's own rule
 * beats their role's; then the newest that has started. Null when no rule
 * reaches them.
 */
export function ruleOn(
	rules: readonly PayRule[],
	serviceId: string,
	payee: Payee,
	entityId: string | null,
	paysFor: PayRule['paysFor'],
	day: string
): PayRule | null {
	let best: PayRule | null = null;
	const rank = (r: PayRule) => [r.entityId !== null ? 1 : 0, r.userId !== null ? 1 : 0] as const;
	for (const r of rules) {
		if (r.serviceId !== serviceId || r.paysFor !== paysFor || r.effectiveFrom > day) continue;
		if (r.entityId !== null && r.entityId !== entityId) continue;
		const mine = r.userId === payee.id || (r.roleId !== null && r.roleId === payee.roleId);
		if (!mine) continue;
		if (!best) {
			best = r;
			continue;
		}
		const [ra, rb] = [rank(r), rank(best)];
		if (
			ra[0] > rb[0] ||
			(ra[0] === rb[0] && ra[1] > rb[1]) ||
			(ra[0] === rb[0] && ra[1] === rb[1] && r.effectiveFrom > best.effectiveFrom)
		)
			best = r;
	}
	return best;
}

const ZERO = Decimal.from('0.00');

/**
 * What one person is paid for their time on one entry: an hourly rate counted
 * to the second, a share of the line, a fixed sum, or nothing. Null when no rule
 * reaches them. `line` is what the line billed, for a percentage rule.
 */
export function timePay(
	rule: PayRule | null,
	seconds: number,
	line: Decimal | null
): Decimal | null {
	if (!rule) return null;
	const amount = Decimal.from(rule.amount ?? '0');
	switch (rule.method) {
		case 'per_hour':
			return amount.mul(seconds).div(3600).round(2);
		case 'percent':
			return amount
				.mul(line ?? Decimal.ZERO)
				.div(100)
				.round(2);
		case 'fixed':
			return amount.round(2);
		case 'nothing':
			return ZERO;
	}
}

/**
 * What one person is paid for covered time on one entry: their rule's
 * percentage of `share`, their part of the retainer's charge. A rule of
 * nothing, or of 0%, pays 0.00 even when the charge is not known yet; any other
 * percentage of an unknown charge is unknown. Null when no rule reaches them.
 */
export function coveredPay(rule: PayRule | null, share: Ratio | null): Decimal | null {
	if (!rule) return null;
	if (rule.method === 'nothing') return ZERO;
	const amount = Decimal.from(rule.amount ?? '0');
	if (amount.isZero()) return ZERO;
	if (share === null) return null;
	return share.mul(amount).div(100n).round(2);
}
