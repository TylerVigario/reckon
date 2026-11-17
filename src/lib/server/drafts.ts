import { asUser, db, type Tx } from './db/index.ts';
import { pgError, type Errors } from './field-errors.ts';
import { numberFrom } from '../numbering.ts';

/**
 * A NEW DRAFT FOR A CLIENT: nothing on it yet, and its number taken now, the
 * operator's next, so two drafts started at once cannot share one.
 *
 * A draft may be started on a phone with no signal (#lib/queue), and then takes
 * its number when it arrives: the uuid the phone made for it answers a second
 * arrival with the draft the first one started. A draft is also started when a
 * line arrives for one that has gone out (#lib/server/lines).
 */

/** The business has no operator row, so there is no number to take. */
class NoOperator extends Error {}

/** Takes the next number and starts the draft, in a transaction already open. */
export async function startIn(
	tx: Tx,
	input: { entityId: string; userId: string; clientUuid?: string | null }
): Promise<{ id: string; number: string }> {
	// The row held while the number is taken and moved on, so nobody else takes
	// the same one in between.
	const op = await tx
		.selectFrom('operator')
		.select(['id', 'invoice_number_format as format', 'next_invoice_number as next'])
		.forUpdate()
		.executeTakeFirst();
	if (!op) throw new NoOperator();
	const made = await tx
		.insertInto('invoice')
		.values({
			client_uuid: input.clientUuid ?? null,
			number: numberFrom(op.format, op.next),
			entity_id: input.entityId,
			created_by: input.userId
		})
		.returning(['id', 'number'])
		.executeTakeFirstOrThrow();
	await tx
		.updateTable('operator')
		.set((eb) => ({ next_invoice_number: eb('next_invoice_number', '+', 1) }))
		.where('id', '=', op.id)
		.execute();
	return made;
}

/**
 * The draft a phone started, by the uuid it made for it: only ever its
 * maker's, since the uuid is unique to them and another's finds nothing.
 */
export async function startedOnPhone(clientUuid: string, userId: string) {
	const had = await db
		.selectFrom('invoice')
		.select(['id', 'number'])
		.where('client_uuid', '=', clientUuid)
		.where('created_by', '=', userId)
		.executeTakeFirst();
	return had ?? null;
}

export type Started =
	{ ok: true; id: string; number: string } | { ok: false; detail: string; errors: Errors };

const no = (why: string): Started => ({ ok: false, detail: why, errors: { entity_id: why } });

/** Starts a draft for a client, or answers with the one a phone already started. */
export async function startDraft(input: {
	entityId: string;
	userId: string;
	clientUuid?: string | null;
}): Promise<Started> {
	if (input.clientUuid) {
		const had = await startedOnPhone(input.clientUuid, input.userId);
		if (had) return { ok: true, ...had };
	}
	try {
		const made = await asUser(input.userId, (tx) => startIn(tx, input));
		return { ok: true, ...made };
	} catch (e) {
		if (e instanceof NoOperator) return no('Name the business in Settings first.');
		const pg = pgError(e);
		// The same draft, arriving twice at once: the other copy is in.
		if (
			pg.code === '23505' &&
			pg.constraint === 'invoice_created_by_client_uuid_key' &&
			input.clientUuid
		) {
			const had = await startedOnPhone(input.clientUuid, input.userId);
			if (had) return { ok: true, ...had };
		}
		if (pg.code === '23503') return no('That client no longer exists.');
		if (pg.constraint === 'invoice_number_key')
			return no('The next invoice number is already taken. Move it on in Settings → Invoicing.');
		throw e;
	}
}
