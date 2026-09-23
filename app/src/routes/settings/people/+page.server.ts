import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Who works here, and the capacity each is paid in.
 *
 * What a person is paid is not here: it is a service's pay rules, written
 * against a role or against one person, and shown with the service they pay
 * for. This screen says who holds which role -- which rules can reach them --
 * and how many rules name a person or a role directly.
 */
export const load: PageServerLoad = async () => {
	const [people, roles] = await Promise.all([
		sql<
			{
				id: string;
				name: string;
				email: string;
				active: boolean;
				role: string | null;
				own_rules: number;
			}[]
		>`
			select u.id, u.name, u.email, u.active, r.name as role,
			       (select count(*) from pay_rule pr where pr.user_id = u.id)::int as own_rules
			  from app_user u
			  left join role r on r.id = u.role_id
			 order by u.active desc, u.name`,
		sql<{ id: string; name: string; holders: number; rules: number }[]>`
			select r.id, r.name,
			       (select count(*) from app_user u
			         where u.role_id = r.id and u.active)::int as holders,
			       (select count(*) from pay_rule pr where pr.role_id = r.id)::int as rules
			  from role r
			 order by holders desc, r.name`
	]);

	return { people, roles };
};
