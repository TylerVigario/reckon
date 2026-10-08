import { asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Decimal, Ratio, sum } from '#lib/decimal.ts';
import { dated, formatMoney, formatPrice, miles } from '#lib/format.ts';
import { paysWhat } from '#lib/pay-words.ts';
import { db, type Reader } from './db/index.ts';
import * as t from './db/schema/index.ts';
import { businessDefaults, moneyPlaces } from './business.ts';
import { businessDay } from './calendar.ts';
import { entryColumns, loadCatalogue, valueEntries, valueLegs } from './valuation/load.ts';
import { ruleOn, type PayRule } from './valuation/pay.ts';
import { townsOf } from './trips.ts';

/**
 * PAY, AS IT IS OWED AND AS IT WAS PAID (0026).
 *
 * What a person is owed is worked out live, by the valuation, from every piece
 * of their work not yet in a payment: each time entry they worked -- alone or
 * on a crew -- and each trip driven in a vehicle they own. A payment records
 * what each item it covers came to that day, and how, in words, so a later role
 * or rule moves only what is still owed. reckon records a payment; the money
 * moves at the bank.
 */

/** A piece of work a person is owed for. `amount` is null where no rule reaches them. */
export type Owed = {
	kind: 'time' | 'trip';
	id: string;
	day: string;
	place: string;
	/** How the figure is reached: the work, and the rule, in words -- what a payment keeps. */
	said: string;
	amount: string | null;
};

const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

/** The rules behind a figure, in words: "$32.00 an hour, as an Employee, from Mar 1". */
function rulesSaid(
	rules: readonly (PayRule | null)[],
	roles: ReadonlyMap<string, string>,
	names: ReadonlyMap<string, string>,
	currency: string
): string | null {
	const known = rules.filter((r): r is PayRule => r !== null);
	if (!known.length) return null;
	const words = {
		money: (v: string | null) => formatMoney(v, currency),
		unitPrice: (v: string | null) => formatPrice(v, currency)
	};
	return known
		.map((r) => {
			const w = paysWhat({ pays_for: r.paysFor, method: r.method, amount: r.amount }, words);
			const whose = r.userId
				? `${(names.get(r.userId) ?? '').split(' ')[0]}'s own`
				: `as ${an(roles.get(r.roleId ?? '') ?? 'role')}`;
			return [`${w.v} ${w.x}`.trim(), whose, `from ${dated(r.effectiveFrom)}`].join(', ');
		})
		.join(' and ');
}

const hoursOf = (seconds: number) => Ratio.of(seconds).div(3600).round(2).toFixed(2);

/**
 * What each of these people -- everyone, without `who` -- is owed: every piece
 * of their work not yet in a payment that pays them something, or whose pay is
 * not known, oldest first.
 */
export async function owed(who?: readonly string[], r: Reader = db): Promise<Map<string, Owed[]>> {
	const [{ currency }, catalogue, roleRows, peopleRows] = await Promise.all([
		businessDefaults(),
		loadCatalogue(r),
		r.select({ id: t.role.id, name: t.role.name }).from(t.role),
		r.select({ id: t.user.id, name: t.user.name }).from(t.user)
	]);
	const roles = new Map(roleRows.map((x) => [x.id, x.name]));
	const names = new Map(peopleRows.map((x) => [x.id, x.name]));
	const wanted = (id: string) => !who || who.includes(id);
	const out = new Map<string, Owed[]>();
	const add = (userId: string, item: Owed) => out.set(userId, [...(out.get(userId) ?? []), item]);

	// Time: each entry's pay to each person on it.
	const [entries, paidItems] = await Promise.all([
		r
			.select({
				...entryColumns,
				service: t.service.name,
				place: sql<string>`coalesce(${t.site.display}, ${t.entity.name}, 'Internal')`
			})
			.from(t.timeEntry)
			.innerJoin(t.service, eq(t.service.id, t.timeEntry.serviceId))
			.leftJoin(t.site, eq(t.site.id, t.timeEntry.siteId))
			.leftJoin(t.entity, eq(t.entity.id, t.timeEntry.entityId))
			.orderBy(asc(t.timeEntry.workedOn), asc(t.timeEntry.createdAt)),
		r
			.select({
				userId: t.personPaymentItem.userId,
				entryId: t.personPaymentItem.timeEntryId,
				tripId: t.personPaymentItem.tripId
			})
			.from(t.personPaymentItem)
	]);
	const paid = new Set(paidItems.map((p) => `${p.userId}:${p.entryId ?? p.tripId}`));
	const worth = await valueEntries(r, entries);
	for (const e of entries) {
		const w = worth.get(e.id);
		if (!w) continue;
		for (const p of w.people) {
			if (!wanted(p.userId) || paid.has(`${p.userId}:${e.id}`)) continue;
			if (p.paid !== null && p.paid.isZero()) continue;
			// The hours billed, and the hours a retainer covered, where there are any.
			const billedHours = w.billedSeconds ?? (p.coveredSeconds ? 0 : e.seconds);
			const crew = w.heads > 1 ? ` in a crew of ${w.heads}` : '';
			const work = [
				e.service,
				billedHours > 0 ? `${hoursOf(billedHours)} hr${crew}` : null,
				p.coveredSeconds
					? `${hoursOf(p.coveredSeconds)} hr a retainer covered${billedHours > 0 ? '' : crew}`
					: null,
				p.paid === null
					? 'no rule pays it'
					: rulesSaid([p.timeRule, p.coveredRule], roles, names, currency)
			];
			add(p.userId, {
				kind: 'time',
				id: e.id,
				day: e.workedOn,
				place: e.place,
				said: work.filter(Boolean).join(' · '),
				amount: p.paid?.toString() ?? null
			});
		}
	}

	// Trips: the miles each pays the owner of the vehicle it was driven in.
	const trips = await r
		.select({
			id: t.trip.id,
			day: t.trip.travelledOn,
			place: townsOf(t.trip.id),
			vehicleId: t.trip.vehicleId,
			vehicle: t.vehicle.name,
			ownerId: t.vehicle.ownerId
		})
		.from(t.trip)
		.innerJoin(t.vehicle, eq(t.vehicle.id, t.trip.vehicleId))
		.where(isNotNull(t.vehicle.ownerId))
		.orderBy(asc(t.trip.travelledOn));
	const mine = trips.filter((x) => wanted(x.ownerId!) && !paid.has(`${x.ownerId}:${x.id}`));
	if (mine.length) {
		const legs = await r
			.select({
				id: t.tripLeg.id,
				tripId: t.tripLeg.tripId,
				serviceId: t.tripLeg.serviceId,
				entityId: t.tripLeg.entityId,
				miles: t.tripLeg.miles
			})
			.from(t.tripLeg)
			.where(
				inArray(
					t.tripLeg.tripId,
					mine.map((x) => x.id)
				)
			);
		const legWorth = await valueLegs(
			r,
			legs.map((l) => {
				const x = mine.find((m) => m.id === l.tripId)!;
				return { ...l, travelledOn: x.day, vehicleId: x.vehicleId, vehicleOwnerId: x.ownerId };
			})
		);
		for (const x of mine) {
			const its = legs.filter((l) => l.tripId === x.id);
			const pays = its.map((l) => legWorth.get(l.id)?.paid ?? null);
			const amount = pays.every((v) => v !== null) ? sum(pays) : null;
			if (amount !== null && amount.isZero()) continue;
			const owner = {
				id: x.ownerId!,
				roleId: catalogue.people.find((p) => p.id === x.ownerId)?.roleId ?? null
			};
			const used = [
				...new Set(
					its
						.filter((l) => l.serviceId && l.entityId)
						.map((l) => ruleOn(catalogue.rules, l.serviceId!, owner, l.entityId, 'vehicle', x.day))
				)
			];
			const rule =
				amount === null
					? 'no rule pays it'
					: used.length === 1
						? `${rulesSaid(used, roles, names, currency)}, each leg`
						: "by each leg's own rule";
			add(x.ownerId!, {
				kind: 'trip',
				id: x.id,
				day: x.day,
				place: x.place ?? 'A trip',
				said: [
					`Trip in the ${x.vehicle}`,
					miles(sum(its.map((l) => l.miles)).toString()),
					rule
				].join(' · '),
				amount: amount?.toString() ?? null
			});
		}
	}

	for (const [k, items] of out)
		out.set(
			k,
			items.sort((a, b) => a.day.localeCompare(b.day) || a.place.localeCompare(b.place))
		);
	return out;
}

/** A person's payments, newest first, each with what it came to. */
export async function paymentsTo(userId: string, r: Reader = db) {
	const places = await moneyPlaces();
	const rows = await r
		.select({
			id: t.personPayment.id,
			paid_on: t.personPayment.paidOn,
			how: t.personPayment.how,
			note: t.personPayment.note,
			// person_payment named outright: a query with no join writes its own
			// columns unqualified, and a bare id inside the subquery is the item's.
			total: sql<string>`(select coalesce(sum(i.amount), 0)::text from person_payment_item i
			                     where i.payment_id = person_payment.id)`,
			items: sql<number>`(select count(*)::int from person_payment_item i
			                     where i.payment_id = person_payment.id)`
		})
		.from(t.personPayment)
		.where(eq(t.personPayment.userId, userId))
		.orderBy(desc(t.personPayment.paidOn), desc(t.personPayment.createdAt));
	return rows.map((p) => ({ ...p, total: Decimal.from(p.total).toFixed(places) }));
}

/** One payment as it was recorded: who, when, how, and each item as it was said. */
export async function paymentOf(id: string, r: Reader = db) {
	const by = alias(t.user, 'by');
	const corrected = alias(t.personPayment, 'corrected');
	const [payment] = await r
		.select({
			id: t.personPayment.id,
			user_id: t.personPayment.userId,
			person: t.user.name,
			paid_on: t.personPayment.paidOn,
			how: t.personPayment.how,
			note: t.personPayment.note,
			recorded_by: by.name,
			recorded_on: sql<string>`(${businessDay(t.personPayment.createdAt)})::text`
		})
		.from(t.personPayment)
		.innerJoin(t.user, eq(t.user.id, t.personPayment.userId))
		.innerJoin(by, eq(by.id, t.personPayment.createdBy))
		.where(eq(t.personPayment.id, id));
	if (!payment) return null;
	const items = await r
		.select({
			id: t.personPaymentItem.id,
			amount: t.personPaymentItem.amount,
			said: t.personPaymentItem.said,
			day: sql<
				string | null
			>`coalesce(${t.timeEntry.workedOn}, ${t.trip.travelledOn}, ${corrected.paidOn})`,
			place: sql<
				string | null
			>`coalesce(${t.site.display}, ${t.entity.name}, ${townsOf(t.trip.id)}, case when ${t.timeEntry.id} is not null then 'Internal' end)`,
			corrects: corrected.paidOn,
			corrects_id: corrected.id
		})
		.from(t.personPaymentItem)
		.leftJoin(t.timeEntry, eq(t.timeEntry.id, t.personPaymentItem.timeEntryId))
		.leftJoin(t.site, eq(t.site.id, t.timeEntry.siteId))
		.leftJoin(t.entity, eq(t.entity.id, t.timeEntry.entityId))
		.leftJoin(t.trip, eq(t.trip.id, t.personPaymentItem.tripId))
		.leftJoin(corrected, eq(corrected.id, t.personPaymentItem.correctsPaymentId))
		.where(eq(t.personPaymentItem.paymentId, id))
		.orderBy(
			asc(sql`coalesce(${t.timeEntry.workedOn}, ${t.trip.travelledOn}, ${corrected.paidOn})`)
		);
	const places = await moneyPlaces();
	return {
		...payment,
		total: sum(items.map((i) => i.amount)).toFixed(places),
		items
	};
}

/**
 * What each payment recorded for these pieces of work, by person: how the pay
 * report shows a job or a trip as paid, with the figure it was paid at.
 */
export async function recordedFor(
	entryIds: readonly string[],
	tripIds: readonly string[],
	r: Reader = db
) {
	if (!entryIds.length && !tripIds.length)
		return new Map<string, { amount: Decimal; paidOn: string; userId: string }>();
	const rows = await r
		.select({
			userId: t.personPaymentItem.userId,
			entryId: t.personPaymentItem.timeEntryId,
			tripId: t.personPaymentItem.tripId,
			amount: t.personPaymentItem.amount,
			paidOn: t.personPayment.paidOn
		})
		.from(t.personPaymentItem)
		.innerJoin(t.personPayment, eq(t.personPayment.id, t.personPaymentItem.paymentId))
		.where(
			or(
				entryIds.length ? inArray(t.personPaymentItem.timeEntryId, [...entryIds]) : undefined,
				tripIds.length ? inArray(t.personPaymentItem.tripId, [...tripIds]) : undefined
			)
		);
	return new Map(
		rows.map((x) => [
			`${x.userId}:${x.entryId ?? x.tripId}`,
			{ amount: Decimal.from(x.amount), paidOn: x.paidOn, userId: x.userId }
		])
	);
}
