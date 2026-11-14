import { eq, or } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';

/**
 * WHAT A PHONE NAMED BEFORE THE SERVER HAD IT. Something added on a phone with
 * no signal -- a material on a receipt, a service -- keeps the uuid the phone
 * made for it, and what used it there meanwhile names it by that uuid until it
 * arrives (#lib/queue). These find it either way: by its id, or by that uuid.
 * The id as named where neither finds one, for the caller to refuse as gone.
 */
export async function materialNamed(id: string): Promise<string> {
	if (!UUID.test(id)) return id;
	const [m] = await db
		.select({ id: t.material.id })
		.from(t.material)
		.where(or(eq(t.material.id, id), eq(t.material.clientUuid, id)));
	return m?.id ?? id;
}

export async function serviceNamed(id: string): Promise<string> {
	if (!UUID.test(id)) return id;
	const [s] = await db
		.select({ id: t.service.id })
		.from(t.service)
		.where(or(eq(t.service.id, id), eq(t.service.clientUuid, id)));
	return s?.id ?? id;
}
