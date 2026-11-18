import { sql, type Expression, type NotNull, type NumericString, type SqlBool } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { businessToday, personalDay, businessDay, personalToday } from '#lib/server/calendar.ts';
import { sum } from '#lib/decimal.ts';
import { entryColumns, valueEntries } from '#lib/server/valuation/load.ts';
import { lastConfirmed, rateIsStale } from '#lib/server/stale.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { TAX_ROUNDING } from '#lib/server/tax-rules.ts';
import { count, dated } from '#lib/format.ts';
import { stateName } from '#lib/us-states.ts';
import { claimsResold, collectsIn } from '#lib/server/tax-registrations.ts';
import { ageOf, type Age } from '#lib/ageing.ts';
import { crewNames } from '#lib/server/choices.ts';
import { fieldOnly, theirWork } from '#lib/server/mine.ts';
import { owed, paymentsTo } from '#lib/server/pay.ts';
import { isOfflineCopy } from '#lib/offline-copy.ts';
import type { PageServerLoad } from './$types';

/**
 * Today: what is owed, what is ready, and what needs a decision.
 *
 * Someone with Field sees their own day instead (#lib/access): their time this
 * month, what they are owed, their work today, and the drafts to add to --
 * nothing of what the business is owed, holds or has not billed.
 *
 * Figures are computed in Postgres, or by the valuation in exact decimals.
 * Money is NUMERIC and stays a string all the way to the page -- adding cents
 * as floats is how they go missing, and these figures sit side by side where
 * one out would show.
 *
 * The date comes from the database rather than from `new Date()`: the server's
 * clock is UTC and toISOString() west of Greenwich calls it tomorrow from five
 * in the afternoon.
 *
 * KEPT FOR NO SIGNAL (#lib/offline-copy), it is everyone's own day, Full's
 * too: what is running, their time this month and today, and the drafts to
 * add to -- the work done on site. What anyone is owed, and what a draft
 * comes to, need a connection.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const offline = isOfflineCopy(url);
	const places = await moneyPlaces();
	const owing = balances(TAX_ROUNDING, places);
	const today = businessToday();

	// The newest drafts, for either day.
	const recentDrafts = () =>
		db
			.selectFrom('invoice as i')
			.innerJoin('entity as e', 'e.id', 'i.entity_id')
			.innerJoin(owing.as('b'), 'b.invoice_id', 'i.id')
			.select((eb) => [
				'i.id',
				'i.number',
				'e.name as who',
				eb
					.cast<string>(
						eb
							.selectFrom('invoice_line')
							.select((eb) => eb.fn.countAll().as('n'))
							.whereRef('invoice_line.invoice_id', '=', 'i.id')
							.$asScalar(),
						'text'
					)
					.as('lines'),
				eb.cast<string>('b.gross', 'text').as('gross')
			])
			.where('i.status', '=', 'draft')
			.orderBy('i.created_at', 'desc')
			.limit(3)
			.execute();

	// Names for whatever the browser has a timer running against. The timer
	// itself is local -- it survives a refresh because it is written down in the
	// browser, not because the server was told -- so only the labels come from
	// here.
	const timerNames = async () => {
		const [entities, services] = await Promise.all([
			db.selectFrom('entity').select(['id', 'name']).where('active', '=', true).execute(),
			db.selectFrom('service').select(['id', 'name']).where('active', '=', true).execute()
		]);
		return {
			entity: Object.fromEntries(entities.map((x) => [x.id, x.name])),
			service: Object.fromEntries(services.map((x) => [x.id, x.name]))
		};
	};

	if (fieldOnly(locals) || offline) {
		const me = locals.user!.id;
		const day = personalToday();
		const [drafts, names, month, work, pay] = await Promise.all([
			recentDrafts(),
			timerNames(),
			db
				.selectFrom('time_entry')
				.select((eb) =>
					eb
						.cast<string>(eb.fn.coalesce(eb.fn.sum('time_entry.seconds'), eb.lit(0)), 'text')
						.as('seconds')
				)
				.where('time_entry.worked_on', '>=', `${day.slice(0, 8)}01`)
				.where((eb) => theirWork(eb, me))
				.executeTakeFirstOrThrow(),
			db
				.selectFrom('time_entry')
				.leftJoin('user as u', 'u.id', 'time_entry.worked_by')
				.innerJoin('service', 'service.id', 'time_entry.service_id')
				.leftJoin('entity', 'entity.id', 'time_entry.entity_id')
				.leftJoin('site', 'site.id', 'time_entry.site_id')
				.select((eb) => [
					'time_entry.id',
					'time_entry.seconds',
					'time_entry.crew',
					'u.name as worked_by',
					crewNames(eb.ref('time_entry.id')).as('crew_names'),
					'entity.name as entity',
					'site.display as site',
					'service.name as service'
				])
				.where('time_entry.worked_on', '=', day)
				.where((eb) => theirWork(eb, me))
				.orderBy('time_entry.created_at', 'desc')
				.orderBy('time_entry.id', 'desc')
				.execute(),
			offline
				? null
				: Promise.all([owed([me]).then((m) => m.get(me) ?? []), paymentsTo(me)]).then(
						([items, payments]) => ({
							owed: sum(items.map((x) => x.amount)).toFixed(places),
							// Work no rule pays yet is owed at no figure, so the total is not all of it.
							unpriced: items.some((x) => x.amount === null),
							last_paid: payments[0]?.paid_on ?? null
						})
					)
		]);
		return {
			today,
			totals: null,
			decisions: [],
			// What each draft comes to is the business's figure, not the day's work.
			drafts: offline ? drafts.map((d) => ({ ...d, gross: null })) : drafts,
			ageing: [],
			names,
			me,
			mine: { monthSeconds: Number(month.seconds), pay, work },
			offline,
			as_of: new Date().toISOString()
		};
	}

	const totals = await db
		.selectFrom(owing.as('b'))
		.select((eb) => {
			const sent = eb('b.status', '=', 'sent');
			const draft = eb('b.status', '=', 'draft');
			const at = (v: Expression<unknown>) => sql<string>`round(${v}, ${places}::int)::text`;
			const total = (figure: 'b.owed' | 'b.gross' | 'b.tax', where: Expression<SqlBool>) =>
				eb.fn.coalesce(eb.fn.sum<NumericString>(figure).filterWhere(where), eb.lit(0));
			const resold = eb
				.selectFrom('invoice_line as il')
				.innerJoin('invoice as i', 'i.id', 'il.invoice_id')
				.select((eb) =>
					eb.fn
						.coalesce(
							sql<NumericString>`sum(${eb.ref('il.ex_tax_cost')} * ${eb.ref('il.tax_rate_pct')} / 100)`,
							eb.lit(0)
						)
						.as('resold')
				)
				.where('il.taxable', '=', true)
				.where('i.status', '=', 'sent')
				.where((eb) => claimsResold(eb.ref('il.tax_state')))
				.$asScalar();
			const remitted = eb
				.selectFrom('tax_remittance')
				.select((eb) =>
					eb.fn.coalesce(eb.fn.sum<NumericString>('amount'), eb.lit(0)).as('remitted')
				)
				.$asScalar();
			return [
				at(total('b.owed', sent)).as('owed'),
				eb
					.cast<string>(
						eb.fn.countAll().filterWhere(eb.and([sent, eb('b.owed', '>', '0')])),
						'text'
					)
					.as('owed_count'),
				at(total('b.gross', draft)).as('drafts'),
				eb.cast<string>(eb.fn.countAll().filterWhere(draft), 'text').as('draft_count'),
				// Collected on somebody else's behalf, so the figure worth seeing is
				// what is STILL HELD: charged on what has gone out, less the Reg 1701
				// credit that comes off the return, less what has been handed to
				// CDTFA. Whether a return was paid is a fact about the world, not
				// something the invoices know, which is why it is subtracted from a
				// table rather than inferred.
				at(sql`${total('b.tax', sent)} - ${resold} - ${remitted}`).as('tax_held')
			];
		})
		.where('b.status', '=', (eb) => eb.fn.any(eb.val(['sent', 'draft'] as const)))
		// An aggregate: always one row.
		.executeTakeFirstOrThrow();

	// Anything that cannot proceed until somebody decides. An invoice out past
	// the operator's own chase-after figure, which opens the invoice, and a
	// site whose rate is not known to be right, which opens its site.
	const overdueInvoices = db
		.selectFrom('invoice as i')
		.innerJoin('entity as e', 'e.id', 'i.entity_id')
		.innerJoin(owing.as('b'), 'b.invoice_id', 'i.id')
		.select((eb) => [
			sql.lit<'invoice' | 'district' | 'unplaced'>('invoice').as('kind'),
			'e.name as client',
			'i.number as ref',
			eb.cast<string | null>(personalDay(eb.ref('i.sent_at')), 'text').as('dated_on'),
			eb.cast<string | null>('b.owed', 'text').as('amount'),
			sql<number | null>`${today}::date - ${businessDay(eb.ref('i.sent_at'))}`.as('days'),
			sql.lit<string | null>(null).as('state'),
			sql<string>`'Invoice ' || ${eb.ref('i.number')} || ' · ' || ${eb.ref('e.name')}`.as('sort'),
			sql.lit<string | null>(null).as('client_slug'),
			sql.lit<string | null>(null).as('site_slug'),
			eb.cast<string | null>('i.id', 'text').as('invoice_id')
		])
		.where('i.status', '=', 'sent')
		.where('b.owed', '>', '0')
		.where('i.sent_at', 'is not', null)
		.where((eb) =>
			eb(
				sql<number>`${today}::date - ${businessDay(eb.ref('i.sent_at'))}`,
				'>',
				eb.fn.coalesce(
					eb.selectFrom('operator').select('ageing_alert_days').$asScalar(),
					eb.lit(30)
				)
			)
		);
	// A site in a state the business collects in whose rate is not known to be
	// right this quarter, or that is in no area there yet.
	const staleRates = db
		.selectFrom('site as s')
		.innerJoin('entity as e', 'e.id', 's.entity_id')
		.leftJoin('tax_area as ta', 'ta.id', 's.tax_area_id')
		.select((eb) => [
			eb
				.case()
				.when('ta.id', 'is', null)
				.then(sql.lit<'invoice' | 'district' | 'unplaced'>('unplaced'))
				.else(sql.lit<'invoice' | 'district' | 'unplaced'>('district'))
				.end()
				.as('kind'),
			'e.name as client',
			's.display as ref',
			eb
				.cast<string | null>(
					lastConfirmed(eb.ref('s.area_verified_on'), eb.ref('ta.confirmed_on')),
					'text'
				)
				.as('dated_on'),
			sql.lit<string | null>(null).as('amount'),
			sql<
				number | null
			>`${today}::date - ${lastConfirmed(eb.ref('s.area_verified_on'), eb.ref('ta.confirmed_on'))}`.as(
				'days'
			),
			's.region as state',
			sql<string>`${eb.ref('e.name')} || ' · ' || ${eb.ref('s.display')} || ' · rate is old'`.as(
				'sort'
			),
			'e.slug as client_slug',
			's.slug as site_slug',
			sql.lit<string | null>(null).as('invoice_id')
		])
		.where('s.active', '=', true)
		.where((eb) => collectsIn(eb.ref('s.region')))
		.where((eb) =>
			eb.or([
				eb('ta.id', 'is', null),
				rateIsStale(lastConfirmed(eb.ref('s.area_verified_on'), eb.ref('ta.confirmed_on')), today)
			])
		)
		.$narrowType<{ ref: NotNull }>();
	const found = await db
		.selectFrom(overdueInvoices.unionAll(staleRates).as('d'))
		.selectAll('d')
		// Critical before warning, by severity rather than by how the kind
		// column happens to sort.
		.orderBy((eb) => eb.case('d.kind').when('invoice').then(eb.lit(0)).else(eb.lit(1)).end())
		.orderBy('d.sort')
		.execute();
	// Written here, with #lib/format, like every other date and count a person
	// reads.
	const decisions = found.map((d) =>
		d.kind === 'invoice'
			? {
					kind: d.kind,
					title: `Invoice ${d.ref} · ${d.client}`,
					detail: `Sent ${dated(d.dated_on)}, still unpaid.`,
					amount: d.amount,
					chip: `Unpaid ${count(d.days!, 'day')}`,
					site: null,
					invoice: d.invoice_id
				}
			: d.kind === 'unplaced'
				? {
						kind: d.kind,
						title: `${d.client} · ${d.ref} · no tax area`,
						detail:
							`The business collects tax in ${stateName(d.state!)}, and nobody has yet ` +
							`said which area of it this site is in, so nothing billed there can be taxed.`,
						amount: d.amount,
						chip: 'No tax area',
						site: { id: d.client_slug!, site: d.site_slug! },
						invoice: null
					}
				: {
						kind: d.kind,
						title: `${d.client} · ${d.ref} · rate is old`,
						detail:
							`CDTFA last confirmed this rate on ${dated(d.dated_on)}. A quarter has begun ` +
							'since, when a district can start or end, and every invoice since could be wrong.',
						amount: d.amount,
						chip: `${count(d.days!, 'day')} since CDTFA confirmed it`,
						site: { id: d.client_slug!, site: d.site_slug! },
						invoice: null
					}
	);

	const drafts = await recentDrafts();

	// Work done and not yet put on an invoice, by how long it has waited.
	// Worth what the valuation says it bills: the price in force on the day it
	// was worked, rounded to the service's increment and never below its
	// minimum -- the same rule an invoice line will use when it is drawn. An hour
	// a retainer covers is not waiting on anything: the retainer has charged
	// for it.
	const unbilled = await db
		.selectFrom('time_entry')
		.select(entryColumns)
		.where('time_entry.billable', '=', true)
		.where((eb) =>
			eb.not(
				eb.exists(
					eb
						.selectFrom('invoice_line')
						.select((eb) => eb.lit(1).as('x'))
						.whereRef('invoice_line.time_entry_id', '=', 'time_entry.id')
				)
			)
		)
		.execute();
	const worth = await valueEntries(db, unbilled);
	const daysAgo = (d: string) => Temporal.PlainDate.from(d).until(today).days;
	const buckets = new Map<Age, { n: number; worth: (string | null)[]; oldest: number }>();
	for (const entry of unbilled) {
		const w = worth.get(entry.id)!;
		if (w.coveredSeconds !== null && w.coveredSeconds >= entry.seconds) continue;
		const days = daysAgo(entry.workedOn);
		const bucket = ageOf(days);
		const b = buckets.get(bucket) ?? { n: 0, worth: [], oldest: 0 };
		b.n += 1;
		b.worth.push(w.billed?.toString() ?? null);
		b.oldest = Math.max(b.oldest, days);
		buckets.set(bucket, b);
	}
	const ageing = [...buckets.entries()].map(([bucket, b]) => ({
		bucket,
		n: String(b.n),
		worth: sum(b.worth).toFixed(places),
		oldest: String(b.oldest)
	}));

	return {
		today,
		totals,
		decisions,
		drafts,
		ageing,
		names: await timerNames(),
		me: locals.user!.id,
		mine: null,
		offline,
		as_of: new Date().toISOString()
	};
};
