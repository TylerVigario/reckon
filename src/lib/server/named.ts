import { db } from '#lib/server/db/index.ts';
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
	const m = await db
		.selectFrom('material')
		.select('id')
		.where((eb) => eb.or([eb('id', '=', id), eb('client_uuid', '=', id)]))
		.executeTakeFirst();
	return m?.id ?? id;
}

export async function serviceNamed(id: string): Promise<string> {
	if (!UUID.test(id)) return id;
	const s = await db
		.selectFrom('service')
		.select('id')
		.where((eb) => eb.or([eb('id', '=', id), eb('client_uuid', '=', id)]))
		.executeTakeFirst();
	return s?.id ?? id;
}
