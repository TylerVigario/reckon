import { and, eq } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import {
	invoice,
	invoiceLine,
	personPaymentItem,
	timeEntry,
	timeEntryCrew,
	user
} from '#lib/server/db/schema/index.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { readBody } from '#lib/json.ts';
import { GONE, readTimeEntry, TIME_FIELDS } from '#lib/server/time-input.ts';
import { pgError, refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';

/**
 * An entry the server has, and whether it is still its own to change: one an
 * invoice was built from, or a payment recorded, stays as it was, and is put
 * right where it was used -- credited on the invoice, or corrected on the next
 * payment. The database holds to the same (0051, and ON DELETE RESTRICT).
 */
async function found(id: string) {
	const [entry] = await db
		.select({
			createdBy: timeEntry.createdBy,
			version: timeEntry.version,
			number: invoice.number,
			status: invoice.status
		})
		.from(timeEntry)
		.leftJoin(invoiceLine, eq(invoiceLine.timeEntryId, timeEntry.id))
		.leftJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
		.where(eq(timeEntry.id, id));
	if (!entry) return null;
	const [paidTo] = await db
		.select({ name: user.name })
		.from(personPaymentItem)
		.innerJoin(user, eq(user.id, personPaymentItem.userId))
		.where(eq(personPaymentItem.timeEntryId, id))
		.limit(1);
	return { ...entry, paidTo: paidTo?.name ?? null };
}

/** Why an entry used on an invoice or in a payment stays as it is, and what to do instead. */
function inUse(entry: NonNullable<Awaited<ReturnType<typeof found>>>, what: string) {
	if (entry.status)
		return problem(
			'conflict',
			409,
			entry.status === 'draft'
				? `That hour is on ${entry.number ? `draft ${entry.number}` : 'a draft'}. Take it off the draft to ${what} it.`
				: `That hour is on invoice ${entry.number}. Credit the invoice instead.`
		);
	if (entry.paidTo)
		return problem(
			'conflict',
			409,
			`That hour is in a payment to ${entry.paidTo}. A correction goes on their next payment.`
		);
	return null;
}

/** Thrown inside the transaction when the entry was saved by someone else meanwhile. */
class Stale extends Error {}

/**
 * Changes a time entry after the fact: for someone with Field, one they
 * entered; for Full, anyone's (#lib/access). The same rules as adding one
 * (#lib/server/time-input), and the save it began from (`version`): one saved
 * by someone else meanwhile is refused, to be opened again and changed from
 * what it is now. One on an invoice or in a payment stays as it was.
 *
 * Its crew goes with it: a team entry's is replaced, and one made one person's
 * loses it. History keeps every field changed, and who changed it.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No entry with that id.');
	const body = await readBody(request);
	if (!body) return problem('malformed', 400, 'Expected a JSON object.');
	const began = body.version;
	if (typeof began !== 'number' || !Number.isInteger(began) || began < 1)
		return refuse({ version: 'The save it began from.' });

	const entry = await found(params.id);
	if (!entry) return problem('notFound', 404, 'No entry with that id.');
	if (fieldOnly(locals) && entry.createdBy !== locals.user!.id)
		return problem('notYours', 403, 'Whoever entered it, or someone with Full, changes it.');
	const used = inUse(entry, 'change');
	if (used) return used;

	const read = await readTimeEntry(body, locals);
	if (!read.ok) return read.refused;
	const e = read.entry;

	let saved: { version: number };
	try {
		saved = await asUser(locals.user!.id, async (tx) => {
			// The crew first: an entry stays a team's while it names one
			// (team_keeps_its_crew), and a team's is replaced whole.
			await tx.delete(timeEntryCrew).where(eq(timeEntryCrew.timeEntryId, params.id));
			const [row] = await tx
				.update(timeEntry)
				.set({
					workedOn: e.workedOn,
					seconds: e.seconds,
					startedAt: e.startedAt,
					endedAt: e.endedAt,
					zone: e.zone,
					crew: e.crew,
					workedBy: e.workedBy,
					entityId: e.entityId,
					siteId: e.siteId,
					serviceId: e.serviceId,
					billable: e.billable,
					note: e.note
				})
				.where(and(eq(timeEntry.id, params.id), eq(timeEntry.version, began)))
				.returning({ version: timeEntry.version });
			if (!row) throw new Stale();
			if (e.crew === 'team')
				await tx
					.insert(timeEntryCrew)
					.values(e.crewIds.map((userId) => ({ timeEntryId: params.id, userId })));
			return row;
		});
	} catch (err) {
		if (err instanceof Stale)
			return problem(
				'conflict',
				409,
				'Someone changed this entry since you opened it. Open it again to see it as it is now.'
			);
		const pg = pgError(err);
		const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
		if (gone) return refuse({ [gone[0]]: gone[1] });
		// Billed or paid between the look above and the save.
		if (pg.code === '23000')
			return problem(
				'conflict',
				409,
				'That hour was billed or paid meanwhile, so it stays as it was.'
			);
		const refused = refuseIfTheDatabaseSaidSo(err, TIME_FIELDS, 'time_entry');
		if (refused) return refused;
		throw err;
	}
	return Response.json({ saved: params.id, version: saved.version });
};

/**
 * Removes a time entry: for someone with Field, one they entered (#lib/access).
 *
 * The database refuses one an invoice was built from -- invoice_line
 * .time_entry_id is ON DELETE RESTRICT -- and records what went, so the answer
 * to "where did that hour go" is in record_history rather than a backup.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No entry with that id.');
	const entry = await found(params.id);
	if (!entry) return problem('notFound', 404, 'No entry with that id.');
	if (fieldOnly(locals) && entry.createdBy !== locals.user!.id)
		return problem('notYours', 403, 'Whoever entered it, or someone with Full, removes it.');
	const used = inUse(entry, 'remove');
	if (used) return used;
	// asUser so record_history names who removed it, rather than nobody.
	await asUser(locals.user!.id, (tx) => tx.delete(timeEntry).where(eq(timeEntry.id, params.id)));
	return Response.json({ deleted: params.id });
};
