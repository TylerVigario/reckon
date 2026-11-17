import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { owed, paymentsTo } from '#lib/server/pay.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { refusedForAccess } from '#lib/server/refused.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One person's pay, as both its tabs head it: what they are owed, piece by
 * piece, and every payment made to them -- Owed corrects a payment already
 * made, Paid lists them. Someone with Field opens only their own, to read
 * (#lib/access).
 */
export const load: LayoutServerLoad = async ({ params, locals, route, request }) => {
	if (!UUID.test(params.person)) error(404, 'Nobody with that id.');
	if (fieldOnly(locals) && params.person !== locals.user!.id) {
		await refusedForAccess({ locals, route, request });
		error(404, 'Nobody with that id.');
	}
	const person = await db
		.selectFrom('user')
		.leftJoin('role', 'role.id', 'user.role_id')
		.select(['user.id', 'user.name', 'role.name as role'])
		.where('user.id', '=', params.person)
		.executeTakeFirst();
	if (!person) error(404, 'Nobody with that id.');
	const [items, payments] = await Promise.all([
		owed([person.id]).then((m) => m.get(person.id) ?? []),
		paymentsTo(person.id)
	]);
	return { person, items, payments, today: businessToday() };
};
