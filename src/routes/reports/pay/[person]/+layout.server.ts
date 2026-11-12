import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
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
	const [person] = await db
		.select({ id: t.user.id, name: t.user.name, role: t.role.name })
		.from(t.user)
		.leftJoin(t.role, eq(t.role.id, t.user.roleId))
		.where(eq(t.user.id, params.person));
	if (!person) error(404, 'Nobody with that id.');
	const [items, payments] = await Promise.all([
		owed([person.id]).then((m) => m.get(person.id) ?? []),
		paymentsTo(person.id)
	]);
	return { person, items, payments, today: businessToday() };
};
