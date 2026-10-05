import { Decimal, Ratio } from '#lib/decimal.ts';

/** A dated price: every client's when entityId is null, or one client's. */
export type Price = {
	serviceId: string;
	entityId: string | null;
	rate: string;
	additionalRate: string;
	effectiveFrom: string;
};

/** How a service charges: what a quantity of it is, how finely, and at least what. */
export type ServiceTerms = {
	id: string;
	unit: 'hour' | 'mile' | 'each';
	billToNearestSeconds: number | null;
	minimumCharge: string | null;
};

/**
 * The price in force for a service, a client and a day: the client's own over
 * every client's, then the newest that has started. Null when none has.
 */
export function priceOn(
	prices: readonly Price[],
	serviceId: string,
	entityId: string | null,
	day: string
): Price | null {
	let best: Price | null = null;
	for (const p of prices) {
		if (p.serviceId !== serviceId || p.effectiveFrom > day) continue;
		if (p.entityId !== null && p.entityId !== entityId) continue;
		if (!best) best = p;
		else {
			const own = (p.entityId !== null ? 1 : 0) - (best.entityId !== null ? 1 : 0);
			if (own > 0 || (own === 0 && p.effectiveFrom > best.effectiveFrom)) best = p;
		}
	}
	return best;
}

/**
 * What the job costs an hour (or a mile, or each) with this many people on it:
 * the first person's rate and the additional rate for each one after, to the
 * currency's `places` (#lib/currency). Null when there is no price.
 */
export function jobRate(price: Price | null, heads: number, places: number): Decimal | null {
	if (!price) return null;
	const extra = BigInt(Math.max(heads - 1, 0));
	return Decimal.from(price.rate).add(Decimal.from(price.additionalRate).mul(extra)).round(places);
}

/**
 * What a quantity of a service bills at a rate: time rounded to the service's
 * increment, the total to the currency's `places`, and never below its minimum
 * charge. The quantity is in the service's own unit -- hours, miles or a count
 * -- and exact, so 25 minutes is 25/60 of an hour with nothing lost. Null when
 * there is no rate.
 */
export function billedAmount(
	service: ServiceTerms,
	rate: Decimal | null,
	quantity: Ratio,
	places: number
): Decimal | null {
	if (rate === null) return null;
	let q = quantity;
	if (service.unit === 'hour' && service.billToNearestSeconds !== null) {
		const step = BigInt(service.billToNearestSeconds);
		const steps = q.mul(3600n).div(step).toBigInt();
		q = Ratio.of(steps * step).div(3600n);
	}
	const amount = q.mul(rate).round(places);
	const floor = Decimal.from(service.minimumCharge ?? '0');
	return Decimal.max(amount, floor).round(places);
}
