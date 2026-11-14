import { and, desc, eq, notLike } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { UUID } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
import { madeAt } from '#lib/server/made-at.ts';
import { MATERIAL_WORDS, parseMaterialField } from '#lib/material-fields.ts';
import type { RequestHandler } from './$types';

const MOST_AT_ONCE = 4;
type Field = keyof typeof MATERIAL_WORDS;
const COLUMN: Record<Field, keyof typeof t.material.$inferSelect> = {
	name: 'name',
	brand: 'brand',
	sku: 'sku',
	taxable: 'taxable',
	unit_id: 'unitId',
	active: 'active'
};
/** A value as the form holds it: text, empty for nothing. */
const asText = (v: unknown) =>
	typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

/** Who last changed a material, and when. */
async function lastChanged(id: string) {
	const [last] = await db
		.select({ by: t.user.name, at: t.recordHistory.changedAt })
		.from(t.recordHistory)
		.leftJoin(t.user, eq(t.user.id, t.recordHistory.changedBy))
		.where(
			and(
				eq(t.recordHistory.tableName, 'material'),
				eq(t.recordHistory.rowId, id),
				notLike(t.recordHistory.field, '(%')
			)
		)
		.orderBy(desc(t.recordHistory.changedAt), desc(t.recordHistory.id))
		.limit(1);
	return { by: last?.by ?? null, at: last?.at.toISOString() ?? null };
}

/**
 * Saves what a material is, a field at a time (#lib/material-fields): its
 * name, brand, SKU, whether it is taxed, what it is counted in, and whether it
 * is offered. What it sells at is its own endpoint, beneath this one.
 *
 * WHAT IT BEGAN FROM. Each save counts (version), and a save says the count it
 * began from and what each field it changes said then (base). Saved by someone
 * else meanwhile, a field they did not touch is changed regardless; one they
 * changed to something else is a conflict, said with what it is now and who
 * made it so, for a person to choose between -- the three-way merge a line's
 * and a time entry's changes make, a field at a time.
 *
 * A SKU is one material's; what it is counted in stays as it was once any of
 * it has been received (a_unit_is_kept_once_received). History keeps every
 * field changed, and who changed it.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No material with that id.');
	const body = await readBody(request);
	const fields = body?.fields;
	if (!fields || typeof fields !== 'object' || Array.isArray(fields))
		return problem('malformed', 400, 'Expected { fields: { name: value }, version, base }.');
	const began = body?.version;
	if (typeof began !== 'number' || !Number.isInteger(began) || began < 1)
		return refuse({ version: 'The save it began from.' });
	const base = body?.base;
	if (!base || typeof base !== 'object' || Array.isArray(base))
		return refuse({ base: 'What each field said when the change began.' });

	const names = Object.keys(fields);
	if (names.length === 0) return problem('malformed', 400, 'No fields given.');
	if (names.length > MOST_AT_ONCE)
		return problem('malformed', 400, `At most ${MOST_AT_ONCE} fields at once.`);
	const row: Partial<typeof t.material.$inferInsert> = {};
	const sent: Partial<Record<Field, string>> = {};
	const errors: Record<string, string> = {};
	for (const name of names) {
		const raw = (fields as Record<string, unknown>)[name];
		if (raw !== null && raw !== undefined && typeof raw !== 'string') {
			errors[name] = 'Expected a value, not a structure.';
			continue;
		}
		const parsed = parseMaterialField(name, asText(raw));
		if (!parsed.ok) errors[name] = parsed.why;
		else {
			Object.assign(row, { [COLUMN[name as Field]]: parsed.value });
			sent[name as Field] = asText(parsed.value);
		}
	}
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [m] = await db.select().from(t.material).where(eq(t.material.id, params.id));
	if (!m) return problem('notFound', 404, 'No material with that id.');

	// Saved meanwhile: a field changed since to something other than this one
	// is a choice for a person, not this save's to overwrite.
	if (m.version !== began)
		for (const name of Object.keys(sent) as Field[]) {
			const now = asText(m[COLUMN[name]]);
			const was = asText((base as Record<string, unknown>)[name]);
			if (now !== was && now !== sent[name]) {
				const last = await lastChanged(m.id);
				return problem(
					'conflict',
					409,
					`${last.by ?? 'Someone'} changed ${MATERIAL_WORDS[name].toLowerCase()} meanwhile. Save puts yours over it; Cancel keeps theirs.`,
					{ members: { conflict: { field: name, theirs: now, ...last, version: m.version } } }
				);
			}
		}

	try {
		const [saved] = await asUser(
			locals.user!.id,
			(tx) =>
				tx
					.update(t.material)
					.set(row)
					.where(eq(t.material.id, m.id))
					.returning({ version: t.material.version }),
			// Made on a phone with no signal, its history says when (#lib/queue).
			madeAt(typeof body.made_at === 'string' ? body.made_at : '')
		);
		return Response.json({ saved: sent, version: saved.version });
	} catch (e) {
		const pg = pgError(e);
		if (pg.constraint === 'material_sku_key')
			return refuse({ sku: 'Another material has that SKU.' });
		if (pg.code === '23000' && /stays as it was/.test(pg.message ?? ''))
			return refuse({
				unit_id:
					'It has been received counted in this. To count it another way, retire it and receive it as something new.'
			});
		throw e;
	}
};
