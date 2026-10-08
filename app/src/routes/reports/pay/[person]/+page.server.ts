import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { owed, paymentsTo } from '#lib/server/pay.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/** One person: what they are owed, piece by piece, and every payment made to them. */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.person)) error(404, 'Nobody with that id.');
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
