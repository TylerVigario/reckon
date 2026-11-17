import type { NotNull } from 'kysely';
import { Decimal, Ratio, sum } from '#lib/decimal.ts';
import { dated, formatMoney, formatPrice, miles } from '#lib/format.ts';
import { PAID_AS_ORDER, paysWhat, type PaidAs } from '#lib/pay-words.ts';
import { db, type Reader } from './db/index.ts';
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
 *
 * What it pays is separate (0027): time pays what the person's role says its
 * pay is -- guaranteed payments, wages or fees -- and a trip pays back the
 * vehicle's owner, whatever their role.
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
	/** What it pays; null where their role has not said, or they hold none. */
	paidAs: PaidAs | null;
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
		r.selectFrom('role').select(['id', 'name', 'pays_as as paysAs']).execute(),
		r.selectFrom('user').select(['id', 'name']).execute()
	]);
	const roles = new Map(roleRows.map((x) => [x.id, x.name]));
	const names = new Map(peopleRows.map((x) => [x.id, x.name]));
	// What a person's time pays: what their role, now, says its pay is.
	const paysAs = new Map(
		catalogue.people.map((p) => [p.id, roleRows.find((x) => x.id === p.roleId)?.paysAs ?? null])
	);
	const wanted = (id: string) => !who || who.includes(id);
	const out = new Map<string, Owed[]>();
	const add = (userId: string, item: Owed) => out.set(userId, [...(out.get(userId) ?? []), item]);

	// Time: each entry's pay to each person on it.
	const [entries, paidItems] = await Promise.all([
		r
			.selectFrom('time_entry')
			.innerJoin('service', 'service.id', 'time_entry.service_id')
			.leftJoin('site', 'site.id', 'time_entry.site_id')
			.leftJoin('entity', 'entity.id', 'time_entry.entity_id')
			.select((eb) => [
				...entryColumns,
				'service.name as service',
				eb.fn.coalesce('site.display', 'entity.name', eb.val('Internal')).as('place')
			])
			.orderBy('time_entry.worked_on')
			.orderBy('time_entry.created_at')
			.execute(),
		r
			.selectFrom('person_payment_item')
			.select(['user_id as userId', 'time_entry_id as entryId', 'trip_id as tripId'])
			.execute()
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
				amount: p.paid?.toString() ?? null,
				paidAs: paysAs.get(p.userId) ?? null
			});
		}
	}

	// Trips: the miles each pays the owner of the vehicle it was driven in.
	const trips = await r
		.selectFrom('trip')
		.innerJoin('vehicle', 'vehicle.id', 'trip.vehicle_id')
		.select((eb) => [
			'trip.id',
			'trip.travelled_on as day',
			townsOf(eb.ref('trip.id')).as('place'),
			'trip.vehicle_id as vehicleId',
			'vehicle.name as vehicle',
			'vehicle.owner_id as ownerId'
		])
		.where('vehicle.owner_id', 'is not', null)
		.$narrowType<{ ownerId: NotNull }>()
		.orderBy('trip.travelled_on')
		.execute();
	const mine = trips.filter((x) => wanted(x.ownerId) && !paid.has(`${x.ownerId}:${x.id}`));
	if (mine.length) {
		const legs = await r
			.selectFrom('trip_leg')
			.select([
				'id',
				'trip_id as tripId',
				'service_id as serviceId',
				'entity_id as entityId',
				'miles'
			])
			.where('trip_id', '=', (eb) => eb.fn.any(eb.val(mine.map((x) => x.id))))
			.execute();
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
				id: x.ownerId,
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
			add(x.ownerId, {
				kind: 'trip',
				id: x.id,
				day: x.day,
				place: x.place ?? 'A trip',
				said: [
					`Trip in the ${x.vehicle}`,
					miles(sum(its.map((l) => l.miles)).toString()),
					rule
				].join(' · '),
				amount: amount?.toString() ?? null,
				paidAs: 'reimbursement'
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

/** A person's payments, newest first, each with what it came to, and what each part paid. */
export async function paymentsTo(userId: string, r: Reader = db) {
	const places = await moneyPlaces();
	const [rows, parts] = await Promise.all([
		r
			.selectFrom('person_payment')
			.select((eb) => [
				'id',
				'paid_on',
				'how',
				'note',
				// person_payment named outright: a query with no join writes its own
				// columns unqualified, and a bare id inside the subquery is the item's.
				eb
					.selectFrom('person_payment_item as i')
					.whereRef('i.payment_id', '=', 'person_payment.id')
					.select((eb) =>
						eb.cast<string>(eb.fn.coalesce(eb.fn.sum('i.amount'), eb.lit(0)), 'text').as('total')
					)
					.$asScalar()
					.as('total'),
				eb
					.selectFrom('person_payment_item as i')
					.whereRef('i.payment_id', '=', 'person_payment.id')
					.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('items'))
					.$asScalar()
					.as('items')
			])
			.where('user_id', '=', userId)
			.orderBy('paid_on', 'desc')
			.orderBy('created_at', 'desc')
			.execute(),
		r
			.selectFrom('person_payment_item')
			.select((eb) => [
				'payment_id as paymentId',
				'paid_as as paidAs',
				eb.cast<string>(eb.fn.sum('amount'), 'text').as('total')
			])
			.where('user_id', '=', userId)
			.groupBy(['payment_id', 'paid_as'])
			.execute()
	]);
	return rows.map((p) => ({
		...p,
		total: Decimal.from(p.total).toFixed(places),
		parts: parts
			.filter((x) => x.paymentId === p.id)
			.sort((a, b) => PAID_AS_ORDER.indexOf(a.paidAs) - PAID_AS_ORDER.indexOf(b.paidAs))
			.map((x) => ({ paid_as: x.paidAs, total: Decimal.from(x.total).toFixed(places) }))
	}));
}

/** One payment as it was recorded: who, when, how, and each item as it was said. */
export async function paymentOf(id: string, r: Reader = db) {
	const payment = await r
		.selectFrom('person_payment')
		.innerJoin('user', 'user.id', 'person_payment.user_id')
		.innerJoin('user as by', 'by.id', 'person_payment.created_by')
		.select((eb) => [
			'person_payment.id',
			'person_payment.user_id',
			'user.name as person',
			'person_payment.paid_on',
			'person_payment.how',
			'person_payment.note',
			'by.name as recorded_by',
			businessDay(eb.ref('person_payment.created_at')).as('recorded_on')
		])
		.where('person_payment.id', '=', id)
		.executeTakeFirst();
	if (!payment) return null;
	const items = await r
		.selectFrom('person_payment_item')
		.leftJoin('time_entry', 'time_entry.id', 'person_payment_item.time_entry_id')
		.leftJoin('site', 'site.id', 'time_entry.site_id')
		.leftJoin('entity', 'entity.id', 'time_entry.entity_id')
		.leftJoin('trip', 'trip.id', 'person_payment_item.trip_id')
		.leftJoin(
			'person_payment as corrected',
			'corrected.id',
			'person_payment_item.corrects_payment_id'
		)
		.select((eb) => [
			'person_payment_item.id',
			'person_payment_item.amount',
			'person_payment_item.said',
			'person_payment_item.paid_as',
			eb.fn.coalesce('time_entry.worked_on', 'trip.travelled_on', 'corrected.paid_on').as('day'),
			eb.fn
				.coalesce(
					'site.display',
					'entity.name',
					townsOf(eb.ref('trip.id')),
					eb.case().when('time_entry.id', 'is not', null).then('Internal').end()
				)
				.as('place'),
			'corrected.paid_on as corrects',
			'corrected.id as corrects_id'
		])
		.where('person_payment_item.payment_id', '=', id)
		.orderBy('day')
		.execute();
	const places = await moneyPlaces();
	return {
		...payment,
		total: sum(items.map((i) => i.amount)).toFixed(places),
		items
	};
}

/**
 * What each payment recorded for these pieces of work, by person: how the pay
 * report shows a job or a trip as paid, with the figure it was paid at and what
 * it paid.
 */
export async function recordedFor(
	entryIds: readonly string[],
	tripIds: readonly string[],
	r: Reader = db
) {
	if (!entryIds.length && !tripIds.length)
		return new Map<string, { amount: Decimal; paidOn: string; userId: string; paidAs: PaidAs }>();
	const rows = await r
		.selectFrom('person_payment_item')
		.innerJoin('person_payment', 'person_payment.id', 'person_payment_item.payment_id')
		.select([
			'person_payment_item.user_id as userId',
			'person_payment_item.time_entry_id as entryId',
			'person_payment_item.trip_id as tripId',
			'person_payment_item.amount',
			'person_payment_item.paid_as as paidAs',
			'person_payment.paid_on as paidOn'
		])
		.where((eb) =>
			eb.or([
				eb('person_payment_item.time_entry_id', '=', eb.fn.any(eb.val(entryIds))),
				eb('person_payment_item.trip_id', '=', eb.fn.any(eb.val(tripIds)))
			])
		)
		.execute();
	return new Map(
		rows.map((x) => [
			`${x.userId}:${x.entryId ?? x.tripId}`,
			{ amount: Decimal.from(x.amount), paidOn: x.paidOn, userId: x.userId, paidAs: x.paidAs }
		])
	);
}
