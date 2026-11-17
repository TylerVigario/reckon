import { businessToday } from './calendar.ts';
import { db } from './db/index.ts';

export type RowState = 'current' | 'scheduled' | 'superseded';

export type PriceRow = {
	id: string;
	service_id: string;
	entity_id: string | null;
	client: string | null;
	rate: string;
	additional_rate: string;
	effective_from: string;
	until: string | null;
	state: RowState;
};

export type RuleRow = {
	id: string;
	service_id: string;
	role_id: string | null;
	user_id: string | null;
	entity_id: string | null;
	payee: string;
	is_role: boolean;
	client: string | null;
	pays_for: 'time' | 'covered_time' | 'vehicle';
	method: 'per_hour' | 'percent' | 'fixed' | 'nothing';
	amount: string | null;
	effective_from: string;
	until: string | null;
	state: RowState;
};

/**
 * Every price row, or one service's, each with its state: the one in force, one
 * waiting to start, or one a later row in the same scope took over from -- which
 * can then say the period it was true for. The services screen shows the first
 * two; a service's history shows all three.
 */
export async function prices(serviceId: string | null = null): Promise<PriceRow[]> {
	const today = businessToday();
	const scope = ['sp.service_id', 'sp.entity_id'] as const;
	return db
		.selectFrom('service_price as sp')
		.leftJoin('entity as e', 'e.id', 'sp.entity_id')
		.$if(serviceId !== null, (qb) => qb.where('sp.service_id', '=', serviceId!))
		.select((eb) => [
			'sp.id',
			'sp.service_id',
			'sp.entity_id',
			'e.name as client',
			'sp.rate',
			'sp.additional_rate',
			eb.cast<string>('sp.effective_from', 'text').as('effective_from'),
			eb
				.cast<string | null>(
					eb.fn
						.agg<string | null>('lead', ['sp.effective_from'])
						.over((ob) => ob.partitionBy(scope).orderBy('sp.effective_from')),
					'text'
				)
				.as('until'),
			eb
				.case()
				.when('sp.effective_from', '>', today)
				.then<RowState>('scheduled')
				.when(
					'sp.id',
					'=',
					eb.fn.agg<string>('first_value', ['sp.id']).over((ob) =>
						ob
							.partitionBy(scope)
							.orderBy(eb('sp.effective_from', '<=', today), 'desc')
							.orderBy('sp.effective_from', 'desc')
					)
				)
				.then<RowState>('current')
				.else<RowState>('superseded')
				.end()
				.as('state')
		])
		.orderBy('sp.service_id')
		.orderBy((eb) => eb('sp.entity_id', 'is not', null))
		.orderBy('e.name')
		.orderBy('sp.effective_from', 'desc')
		.execute();
}

/**
 * The same, for pay rules. A rule's scope is everything that makes it more or
 * less specific: whom it pays, for what, and for which client.
 */
export async function rules(serviceId: string | null = null): Promise<RuleRow[]> {
	const today = businessToday();
	const scope = [
		'pr.service_id',
		'pr.role_id',
		'pr.user_id',
		'pr.entity_id',
		'pr.pays_for'
	] as const;
	return db
		.selectFrom('pay_rule as pr')
		.leftJoin('role as r', 'r.id', 'pr.role_id')
		.leftJoin('user as u', 'u.id', 'pr.user_id')
		.leftJoin('entity as e', 'e.id', 'pr.entity_id')
		.$if(serviceId !== null, (qb) => qb.where('pr.service_id', '=', serviceId!))
		.select((eb) => [
			'pr.id',
			'pr.service_id',
			'pr.role_id',
			'pr.user_id',
			'pr.entity_id',
			// A rule names a role or a person, never neither (pay_rule_names_one_payee).
			eb.fn.coalesce('r.name', 'u.name').$notNull().as('payee'),
			eb('pr.role_id', 'is not', null).$castTo<boolean>().as('is_role'),
			'e.name as client',
			'pr.pays_for',
			'pr.method',
			'pr.amount',
			eb.cast<string>('pr.effective_from', 'text').as('effective_from'),
			eb
				.cast<string | null>(
					eb.fn
						.agg<string | null>('lead', ['pr.effective_from'])
						.over((ob) => ob.partitionBy(scope).orderBy('pr.effective_from')),
					'text'
				)
				.as('until'),
			eb
				.case()
				.when('pr.effective_from', '>', today)
				.then<RowState>('scheduled')
				.when(
					'pr.id',
					'=',
					eb.fn.agg<string>('first_value', ['pr.id']).over((ob) =>
						ob
							.partitionBy(scope)
							.orderBy(eb('pr.effective_from', '<=', today), 'desc')
							.orderBy('pr.effective_from', 'desc')
					)
				)
				.then<RowState>('current')
				.else<RowState>('superseded')
				.end()
				.as('state')
		])
		.orderBy('pr.service_id')
		.orderBy((eb) => eb('pr.entity_id', 'is not', null))
		.orderBy('e.name')
		.orderBy((eb) => eb('pr.user_id', 'is not', null))
		.orderBy('payee')
		.orderBy('pr.effective_from', 'desc')
		.execute();
}
