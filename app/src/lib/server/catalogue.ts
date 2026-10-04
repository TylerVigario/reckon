import { businessToday } from './calendar.ts';
import { sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { entity, payRule, role, servicePrice, user } from './db/schema/index.ts';

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
	const { rows } = await db.execute<PriceRow>(sql`
		select ${servicePrice.id}, ${servicePrice.serviceId} as service_id,
		       ${servicePrice.entityId} as entity_id, ${entity.name} as client,
		       ${servicePrice.rate}, ${servicePrice.additionalRate} as additional_rate,
		       ${servicePrice.effectiveFrom}::text as effective_from,
		       (lead(${servicePrice.effectiveFrom}) over scope_by_date)::text as until,
		       case
		         when ${servicePrice.effectiveFrom} > ${businessToday()}::date then 'scheduled'
		         when ${servicePrice.id} = first_value(${servicePrice.id}) over scope_in_force then 'current'
		         else 'superseded'
		       end as state
		  from ${servicePrice}
		  left join ${entity} on ${entity.id} = ${servicePrice.entityId}
		 where (${serviceId}::uuid is null or ${servicePrice.serviceId} = ${serviceId}::uuid)
		window scope_by_date as (partition by ${servicePrice.serviceId}, ${servicePrice.entityId}
		                         order by ${servicePrice.effectiveFrom}),
		       scope_in_force as (partition by ${servicePrice.serviceId}, ${servicePrice.entityId}
		                          order by (${servicePrice.effectiveFrom} <= ${businessToday()}::date) desc,
		                                   ${servicePrice.effectiveFrom} desc)
		 order by ${servicePrice.serviceId}, (${servicePrice.entityId} is not null), ${entity.name},
		          ${servicePrice.effectiveFrom} desc`);
	return rows;
}

/**
 * The same, for pay rules. A rule's scope is everything that makes it more or
 * less specific: whom it pays, for what, and for which client.
 */
export async function rules(serviceId: string | null = null): Promise<RuleRow[]> {
	const { rows } = await db.execute<RuleRow>(sql`
		select ${payRule.id}, ${payRule.serviceId} as service_id, ${payRule.roleId} as role_id,
		       ${payRule.userId} as user_id, ${payRule.entityId} as entity_id,
		       coalesce(${role.name}, ${user.name}) as payee, ${payRule.roleId} is not null as is_role,
		       ${entity.name} as client, ${payRule.paysFor} as pays_for, ${payRule.method},
		       ${payRule.amount}, ${payRule.effectiveFrom}::text as effective_from,
		       (lead(${payRule.effectiveFrom}) over scope_by_date)::text as until,
		       case
		         when ${payRule.effectiveFrom} > ${businessToday()}::date then 'scheduled'
		         when ${payRule.id} = first_value(${payRule.id}) over scope_in_force then 'current'
		         else 'superseded'
		       end as state
		  from ${payRule}
		  left join ${role} on ${role.id} = ${payRule.roleId}
		  left join ${user} on ${user.id} = ${payRule.userId}
		  left join ${entity} on ${entity.id} = ${payRule.entityId}
		 where (${serviceId}::uuid is null or ${payRule.serviceId} = ${serviceId}::uuid)
		window scope_by_date as (partition by ${payRule.serviceId}, ${payRule.roleId}, ${payRule.userId},
		                                      ${payRule.entityId}, ${payRule.paysFor}
		                         order by ${payRule.effectiveFrom}),
		       scope_in_force as (partition by ${payRule.serviceId}, ${payRule.roleId}, ${payRule.userId},
		                                       ${payRule.entityId}, ${payRule.paysFor}
		                          order by (${payRule.effectiveFrom} <= ${businessToday()}::date) desc,
		                                   ${payRule.effectiveFrom} desc)
		 order by ${payRule.serviceId}, (${payRule.entityId} is not null), ${entity.name},
		          (${payRule.userId} is not null), payee, ${payRule.effectiveFrom} desc`);
	return rows;
}
