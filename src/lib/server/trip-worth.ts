import { and, asc, eq } from 'drizzle-orm';
import { Decimal, sum } from '#lib/decimal.ts';
import type { Leg } from '#lib/trip-legs.ts';
import { db } from './db/index.ts';
import * as t from './db/schema/index.ts';
import { moneyPlaces } from './business.ts';
import { loadCatalogue } from './valuation/load.ts';
import { legVehiclePay, legWorth } from './valuation/misc.ts';
import { ruleOn } from './valuation/pay.ts';

/** The services charged by the mile, which a trip's legs bill as. */
export const mileServices = () =>
	db
		.select({ id: t.service.id, name: t.service.name })
		.from(t.service)
		.where(and(eq(t.service.unit, 'mile'), eq(t.service.active, true)))
		.orderBy(asc(t.service.name));

/**
 * The service a trip's billed legs bill as: the one asked for, or the only one
 * charged by the mile. A refusal, in words, when there is none to choose or
 * more than one and none was chosen.
 */
export async function mileServiceFor(
	asked: string | null
): Promise<{ id: string } | { why: string }> {
	const services = await mileServices();
	if (asked) {
		return services.some((s) => s.id === asked)
			? { id: asked }
			: { why: 'That service is not charged by the mile.' };
	}
	if (services.length === 1) return { id: services[0].id };
	return services.length
		? { why: 'Which service its miles bill as.' }
		: { why: 'Nothing is charged by the mile yet: give one a price in Settings → Travel.' };
}

/**
 * What a trip's legs bill, and what each pays the vehicle it was driven in,
 * before the trip is saved: the valuation's own functions, so the figures the
 * form shows are the ones the saved trip will have.
 */
export async function tripWorth(input: {
	travelledOn: string;
	vehicleId: string | null;
	serviceId: string | null;
	legs: readonly Leg[];
}) {
	const [{ services, prices, rules, people }, places, vehicle] = await Promise.all([
		loadCatalogue(db),
		moneyPlaces(),
		input.vehicleId
			? db
					.select({ ownerId: t.vehicle.ownerId })
					.from(t.vehicle)
					.where(eq(t.vehicle.id, input.vehicleId))
					.then((r) => r[0] ?? null)
			: Promise.resolve(null)
	]);
	const owner = vehicle?.ownerId
		? { id: vehicle.ownerId, roleId: people.find((p) => p.id === vehicle.ownerId)?.roleId ?? null }
		: null;
	const legs = input.legs.map((l) => {
		const leg = {
			serviceId: l.entityId ? input.serviceId : null,
			entityId: l.entityId,
			miles: l.miles
		};
		const w = legWorth(leg, input.travelledOn, services, prices, places);
		const billed = l.entityId ? w.billed : Decimal.ZERO.round(places);
		const paid = legVehiclePay(
			leg,
			billed,
			input.travelledOn,
			vehicle ? { owner } : null,
			rules,
			places
		);
		const rule =
			owner && l.entityId && input.serviceId
				? ruleOn(rules, input.serviceId, owner, l.entityId, 'vehicle', input.travelledOn)
				: null;
		return {
			billed: billed?.toFixed(places) ?? null,
			paid: paid?.toFixed(places) ?? null,
			rate: l.entityId ? (w.rate?.toString() ?? null) : null,
			rule
		};
	});
	// The rate and the rule, said once where every billed leg shares them.
	const billedLegs = legs.filter((l, k) => input.legs[k].entityId);
	const rates = [...new Set(billedLegs.map((l) => l.rate))];
	const used = [...new Set(billedLegs.map((l) => l.rule))];
	const billed = legs.every((l) => l.billed !== null) ? sum(legs.map((l) => l.billed)) : null;
	const paid = vehicle && legs.every((l) => l.paid !== null) ? sum(legs.map((l) => l.paid)) : null;
	return {
		legs: legs.map((l) => ({ billed: l.billed, paid: l.paid })),
		rate: rates.length === 1 ? rates[0] : null,
		rule:
			used.length === 1 && used[0]
				? { pays_for: used[0].paysFor, method: used[0].method, amount: used[0].amount }
				: null,
		billed: billed?.toFixed(places) ?? null,
		paid: paid?.toFixed(places) ?? null,
		kept: billed && paid ? billed.sub(paid).toFixed(places) : null
	};
}
