import { sql } from './db';

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
export function prices(serviceId: string | null = null) {
	return sql<PriceRow[]>`
		select sp.id, sp.service_id, sp.entity_id, e.name as client,
		       sp.rate, sp.additional_rate, sp.effective_from::text,
		       (lead(sp.effective_from) over scope_by_date)::text as until,
		       case
		         when sp.effective_from > current_date then 'scheduled'
		         when sp.id = first_value(sp.id) over scope_in_force then 'current'
		         else 'superseded'
		       end as state
		  from service_price sp
		  left join entity e on e.id = sp.entity_id
		 where (${serviceId}::uuid is null or sp.service_id = ${serviceId}::uuid)
		window scope_by_date as (partition by sp.service_id, sp.entity_id
		                         order by sp.effective_from),
		       scope_in_force as (partition by sp.service_id, sp.entity_id
		                          order by (sp.effective_from <= current_date) desc,
		                                   sp.effective_from desc)
		 order by sp.service_id, (sp.entity_id is not null), e.name, sp.effective_from desc`;
}

/**
 * The same, for pay rules. A rule's scope is everything that makes it more or
 * less specific: whom it pays, for what, and for which client.
 */
export function rules(serviceId: string | null = null) {
	return sql<RuleRow[]>`
		select pr.id, pr.service_id, pr.role_id, pr.user_id, pr.entity_id,
		       coalesce(r.name, u.name) as payee, pr.role_id is not null as is_role,
		       e.name as client, pr.pays_for, pr.method, pr.amount,
		       pr.effective_from::text,
		       (lead(pr.effective_from) over scope_by_date)::text as until,
		       case
		         when pr.effective_from > current_date then 'scheduled'
		         when pr.id = first_value(pr.id) over scope_in_force then 'current'
		         else 'superseded'
		       end as state
		  from pay_rule pr
		  left join role r on r.id = pr.role_id
		  left join app_user u on u.id = pr.user_id
		  left join entity e on e.id = pr.entity_id
		 where (${serviceId}::uuid is null or pr.service_id = ${serviceId}::uuid)
		window scope_by_date as (partition by pr.service_id, pr.role_id, pr.user_id,
		                                      pr.entity_id, pr.pays_for
		                         order by pr.effective_from),
		       scope_in_force as (partition by pr.service_id, pr.role_id, pr.user_id,
		                                       pr.entity_id, pr.pays_for
		                          order by (pr.effective_from <= current_date) desc,
		                                   pr.effective_from desc)
		 order by pr.service_id, (pr.entity_id is not null), e.name,
		          (pr.user_id is not null), payee, pr.effective_from desc`;
}
