import type { Updateable } from 'kysely';
import type { TaxRegistration } from '#lib/server/db/database.ts';
import { asUser, db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { answerEveryKind, Refused } from '#lib/server/sale-kinds.ts';
import { parseAnswers } from '#lib/kind-fields.ts';
import { type Errors, refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { parseRegistrationField, REGISTRATION_FIELDS } from '#lib/registration-fields.ts';
import { COLLECTABLE, stateName, type State } from '#lib/us-states.ts';
import { syncTaxNow } from '#lib/server/tax-sync.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields, readJson } from '#lib/json.ts';

/**
 * A state the business collects tax in (#lib/server/tax-registrations). PUT
 * collects there, answering whether it taxes each kind of sale -- { taxed: {
 * [kind]: true | false } }, one for every kind (#lib/server/sale-kinds) --
 * PATCH changes what the registration says a field at a time, as Settings →
 * Tax saves it, and DELETE stops collecting there, its answers with it -- the
 * lines already taxed there and the returns already handed in keep their state.
 *
 * Only a state with a sales tax can be collected in (#lib/us-states
 * COLLECTABLE). In California CDTFA places its sites; anywhere else a person
 * types its areas in and chooses each site's (#lib/server/typed-areas).
 */
const collectable = (s: string): s is State => (COLLECTABLE as readonly string[]).includes(s);

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!collectable(params.state))
		return problem('notFound', 404, `Tax cannot be collected in ${stateName(params.state)} here.`);
	const body = (await readJson(request).catch(() => null)) as { taxed?: unknown } | null;
	const kinds = await db.selectFrom('sale_kind').select(['id', 'name']).execute();
	const name = new Map(kinds.map((k) => [k.id, k.name]));
	const { answers, errors } = parseAnswers(
		body?.taxed,
		kinds.map((k) => k.id),
		(k) => `Whether ${stateName(params.state)} taxes ${name.get(k)}.`
	);
	const had = await db
		.selectFrom('tax_registration')
		.select('state')
		.where('state', '=', params.state)
		.executeTakeFirst();
	if (had) return Response.json({ state: params.state }, { status: 200 });
	if (Object.keys(errors).length) return refuse(errors);
	let made;
	try {
		made = await asUser(locals.user!.id, async (tx) => {
			const row = await tx
				.insertInto('tax_registration')
				.values({ state: params.state })
				.onConflict((oc) => oc.column('state').doNothing())
				.returning('state')
				.executeTakeFirst();
			if (row) await answerEveryKind(tx, params.state, answers, locals.user!.id, businessToday());
			return row;
		});
	} catch (e) {
		if (e instanceof Refused) return refuse({ [e.field]: e.message });
		throw e;
	}
	// Its sites are placed in their areas as soon as the server can ask.
	if (made) syncTaxNow();
	return Response.json({ state: params.state }, { status: made ? 201 : 200 });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');
	const names = Object.keys(fields);
	if (names.length === 0) return problem('malformed', 400, 'No fields given.');

	const row: Record<string, string | boolean | null> = {};
	const errors: Errors = {};
	for (const name of names) {
		const raw = fields[name];
		if (raw !== null && raw !== undefined && typeof raw !== 'string' && typeof raw !== 'number') {
			errors[name] = 'Expected a value, not a structure.';
			continue;
		}
		const parsed = parseRegistrationField(
			name,
			raw === null || raw === undefined ? '' : String(raw)
		);
		if (parsed.ok) row[name] = parsed.value as string | boolean | null;
		else errors[name] = parsed.why;
	}
	if (row.claims_tax_paid_purchases_resold === true && params.state !== 'CA')
		errors.claims_tax_paid_purchases_resold = 'An election of California’s alone.';
	if (Object.keys(errors).length > 0) return refuse(errors);

	try {
		const saved = await asUser(locals.user!.id, (tx) =>
			tx
				.updateTable('tax_registration')
				.set(row as Updateable<TaxRegistration>)
				.where('state', '=', params.state)
				.returning(Object.keys(REGISTRATION_FIELDS) as (keyof typeof REGISTRATION_FIELDS)[])
				.executeTakeFirst()
		);
		if (!saved)
			return problem(
				'notFound',
				404,
				`The business does not collect tax in ${stateName(params.state)}.`
			);
		return Response.json({ saved });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'tax_registration');
		if (refused) return refused;
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const gone = await asUser(locals.user!.id, (tx) =>
		tx.deleteFrom('tax_registration').where('state', '=', params.state).executeTakeFirst()
	);
	if (!gone.numDeletedRows)
		return problem(
			'notFound',
			404,
			`The business does not collect tax in ${stateName(params.state)}.`
		);
	return new Response(null, { status: 204 });
};
