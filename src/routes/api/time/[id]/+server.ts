import { crewChange } from '#lib/crew-change.ts';
import { names } from '#lib/format.ts';
import { asUser, db } from '#lib/server/db/index.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { readBody } from '#lib/json.ts';
import { madeAt } from '#lib/server/made-at.ts';
import { GONE, readTimeEntry, TIME_FIELDS } from '#lib/server/time-input.ts';
import { pgError, refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import type { EntryFields } from '#lib/entry-form.ts';
import { fieldsOfEntry, mergeEntry, type EntryConflict } from '#lib/entry-merge.ts';

/**
 * An entry the server has, as its form sends it (#lib/entry-merge
 * fieldsOfEntry), and whether it is still its own to change: one an invoice
 * was built from, or a payment recorded, stays as it was, and is put right
 * where it was used -- credited on the invoice, or corrected on the next
 * payment. The database holds to the same (0051, and ON DELETE RESTRICT).
 */
async function found(id: string) {
	const entry = await db
		.selectFrom('time_entry')
		.leftJoin('invoice_line', 'invoice_line.time_entry_id', 'time_entry.id')
		.leftJoin('invoice', 'invoice.id', 'invoice_line.invoice_id')
		.select([
			'time_entry.created_by as createdBy',
			'time_entry.version',
			'time_entry.worked_on',
			'time_entry.seconds',
			'time_entry.started_at',
			'time_entry.ended_at',
			'time_entry.zone',
			'time_entry.crew',
			'time_entry.worked_by',
			'time_entry.entity_id',
			'time_entry.site_id',
			'time_entry.service_id',
			'time_entry.billable',
			'time_entry.note',
			'invoice.number',
			'invoice.status'
		])
		.where('time_entry.id', '=', id)
		.executeTakeFirst();
	if (!entry) return null;
	const [paidTo, crew] = await Promise.all([
		// Everyone it was paid to: a team's hour is paid to each of its crew.
		db
			.selectFrom('person_payment_item')
			.innerJoin('user', 'user.id', 'person_payment_item.user_id')
			.select('user.name')
			.where('person_payment_item.time_entry_id', '=', id)
			.orderBy('user.name')
			.orderBy('user.id')
			.execute(),
		db
			.selectFrom('time_entry_crew')
			.select('user_id as id')
			.where('time_entry_id', '=', id)
			.execute()
	]);
	return {
		...entry,
		fields: fieldsOfEntry({
			...entry,
			started_at: entry.started_at?.toISOString() ?? null,
			ended_at: entry.ended_at?.toISOString() ?? null,
			crew_ids: crew.map((c) => c.id)
		}),
		paidTo: paidTo.map((p) => p.name)
	};
}
type Found = NonNullable<Awaited<ReturnType<typeof found>>>;

/** Why an entry used on an invoice or in a payment stays as it is, and what to do instead. */
function inUse(entry: Found, what: string) {
	if (entry.status)
		return problem(
			'conflict',
			409,
			entry.status === 'draft'
				? `That hour is on ${entry.number ? `draft ${entry.number}` : 'a draft'}. Take it off the draft to ${what} it.`
				: `That hour is on invoice ${entry.number}. Credit the invoice instead.`
		);
	if (entry.paidTo.length)
		return problem(
			'conflict',
			409,
			`That hour is in ${entry.paidTo.length === 1 ? 'a payment' : 'payments'} to ${names(entry.paidTo)}. A correction goes on their next payment.`
		);
	return null;
}

/** Who removed an entry, and when, and whose it was: the removal its history keeps. */
async function removed(id: string) {
	const gone = await db
		.selectFrom('record_history')
		.leftJoin('user', 'user.id', 'record_history.changed_by')
		.select([
			'user.name as by',
			'record_history.changed_at as at',
			'record_history.old_value as was'
		])
		.where('record_history.table_name', '=', 'time_entry')
		.where('record_history.row_id', '=', id)
		.where('record_history.field', '=', '(deleted)')
		.orderBy('record_history.changed_at', 'desc')
		.limit(1)
		.executeTakeFirst();
	if (!gone) return null;
	let createdBy: unknown;
	try {
		createdBy = (JSON.parse(gone.was ?? '{}') as { created_by?: unknown }).created_by;
	} catch {
		/* not as it was written; whose it was is not known */
	}
	return { by: gone.by, at: gone.at.toISOString(), createdBy };
}

/** Who last changed an entry on the server, and when: a save, not one it began with. */
async function lastChanged(id: string) {
	const last = await db
		.selectFrom('record_history')
		.leftJoin('user', 'user.id', 'record_history.changed_by')
		.select(['user.name as by', 'record_history.changed_at as at'])
		.where('record_history.table_name', '=', 'time_entry')
		.where('record_history.row_id', '=', id)
		.where('record_history.field', 'not like', '(%')
		.orderBy('record_history.changed_at', 'desc')
		.orderBy('record_history.id', 'desc')
		.limit(1)
		.executeTakeFirst();
	return { by: last?.by ?? null, at: last?.at.toISOString() ?? null };
}

/** What a change ran into, as the phone keeps it (#lib/entry-merge EntryConflict). */
const conflict = (detail: string, c: EntryConflict) =>
	problem('conflict', 409, detail, { members: { conflict: c } });

/** Whoever entered it, or someone with Full, changes or removes it. */
const notYours = (what: string) =>
	problem('notYours', 403, `Whoever entered it, or someone with Full, ${what} it.`);

/** An entry gone before the request reached it: removed, as its history says, or never there. */
async function gone(id: string, locals: App.Locals) {
	const was = await removed(id);
	if (!was || (fieldOnly(locals) && was.createdBy !== locals.user!.id)) return null;
	return was;
}

/** Thrown inside the transaction when the entry was saved by someone else meanwhile. */
class Stale extends Error {}

/** An object of the form's fields, or nothing. */
function fieldsIn(v: unknown): EntryFields | null {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
	const out: Record<string, unknown> = {};
	for (const k of TIME_FIELDS) if (k in v) out[k] = (v as Record<string, unknown>)[k];
	return out as EntryFields;
}

/**
 * Changes a time entry after the fact: for someone with Field, one they
 * entered; for Full, anyone's (#lib/access). The same rules as adding one
 * (#lib/server/time-input), and what the change began from: the entry's save
 * (`version`) and its fields then (`base`). Saved by someone else meanwhile,
 * the two are merged part by part (#lib/entry-merge); a part both changed
 * differently is a collision, kept on the phone for a person to pick. One on
 * an invoice or in a payment stays as it was. `made_at` is when it was made on
 * a phone with no signal, which its history keeps.
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
	const base = fieldsIn(body.base);
	if (!base) return refuse({ base: 'The entry as it was when the change began.' });
	const when = madeAt(typeof body.made_at === 'string' ? body.made_at : '');

	const change = async (attempt: number): Promise<Response> => {
		const entry = await found(params.id);
		if (!entry) {
			const was = await gone(params.id, locals);
			return was
				? conflict(`${was.by ?? 'Someone'} removed this entry while the change was on its way.`, {
						what: 'removed',
						by: was.by,
						at: was.at
					})
				: problem('notFound', 404, 'No entry with that id.');
		}
		if (fieldOnly(locals) && entry.createdBy !== locals.user!.id) return notYours('changes');
		const used = inUse(entry, 'change');
		if (used) return used;

		// Saved meanwhile: merged with the change, part by part, against what the
		// change began from.
		let asked: Record<string, unknown> = body;
		if (entry.version !== began) {
			const m = mergeEntry(base, fieldsIn(body) ?? base, entry.fields);
			if (m.collided.length > 0) {
				const last = await lastChanged(params.id);
				return conflict('Someone else changed this entry as well, and part of it needs a choice.', {
					what: 'collided',
					version: entry.version,
					server: entry.fields,
					collided: m.collided,
					from: m.from,
					...last
				});
			}
			asked = m.fields;
		}

		const read = await readTimeEntry(asked, locals);
		if (!read.ok) return read.refused;
		const e = read.entry;

		let saved: { version: number };
		try {
			saved = await asUser(
				locals.user!.id,
				async (tx) => {
					// Who leaves the crew first: an entry stays a team's while it
					// names one (team_keeps_its_crew). Only who changed is taken
					// off or put on, so its history says who did (0059).
					const had = await tx
						.selectFrom('time_entry_crew')
						.select('user_id as id')
						.where('time_entry_id', '=', params.id)
						.execute();
					const { gone, joined } = crewChange(
						had.map((c) => c.id),
						e.crew === 'team' ? e.crewIds : []
					);
					if (gone.length)
						await tx
							.deleteFrom('time_entry_crew')
							.where('time_entry_id', '=', params.id)
							.where('user_id', '=', (eb) => eb.fn.any(eb.val(gone)))
							.execute();
					const row = await tx
						.updateTable('time_entry')
						.set({
							worked_on: e.workedOn,
							seconds: e.seconds,
							started_at: e.startedAt,
							ended_at: e.endedAt,
							zone: e.zone,
							crew: e.crew,
							worked_by: e.workedBy,
							entity_id: e.entityId,
							site_id: e.siteId,
							service_id: e.serviceId,
							billable: e.billable,
							note: e.note
						})
						.where('id', '=', params.id)
						.where('version', '=', entry.version)
						.returning('version')
						.executeTakeFirst();
					if (!row) throw new Stale();
					if (joined.length)
						await tx
							.insertInto('time_entry_crew')
							.values(joined.map((user_id) => ({ time_entry_id: params.id, user_id })))
							.execute();
					return row;
				},
				when
			);
		} catch (err) {
			// Saved by someone else between the look above and the save: looked at
			// again, and merged with that.
			if (err instanceof Stale) {
				if (attempt < 2) return change(attempt + 1);
				return problem(
					'conflict',
					409,
					'This entry kept changing while it was saved. Nothing was changed; try again.'
				);
			}
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
	return change(0);
};

/**
 * Removes a time entry: for someone with Field, one they entered (#lib/access).
 * It says the save it was removed at (`version`): one changed since is asked
 * about, unless `force`. One already removed is done.
 *
 * The database refuses one an invoice was built from -- invoice_line
 * .time_entry_id is ON DELETE RESTRICT -- and records what went, so the answer
 * to "where did that hour go" is in record_history rather than a backup.
 */
export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No entry with that id.');
	const v = url.searchParams.get('version');
	if (!v || !/^[1-9]\d*$/.test(v)) return refuse({ version: 'The save it was removed at.' });
	const entry = await found(params.id);
	if (!entry)
		return (await gone(params.id, locals))
			? Response.json({ deleted: params.id })
			: problem('notFound', 404, 'No entry with that id.');
	if (fieldOnly(locals) && entry.createdBy !== locals.user!.id) return notYours('removes');
	const used = inUse(entry, 'remove');
	if (used) return used;
	if (entry.version !== Number(v) && url.searchParams.get('force') !== '1') {
		const last = await lastChanged(params.id);
		return conflict(
			`${last.by ?? 'Someone'} changed this entry after it was removed on this phone.`,
			{ what: 'changed', ...last }
		);
	}
	// asUser so record_history names who removed it, rather than nobody.
	await asUser(
		locals.user!.id,
		(tx) => tx.deleteFrom('time_entry').where('id', '=', params.id).execute(),
		madeAt(url.searchParams.get('made_at') ?? '')
	);
	return Response.json({ deleted: params.id });
};
