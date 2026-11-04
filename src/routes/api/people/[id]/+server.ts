import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { OWN_FIELDS, PERSON_FIELDS, parsePersonField } from '#lib/people-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';
import { knownZone } from '#lib/server/zones.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { fieldOnly } from '#lib/server/mine.ts';

/** Each field as the user table names it. */
const COLUMN = {
	role_id: 'roleId',
	access: 'access',
	timezone: 'timezone',
	locale: 'locale',
	hour_cycle: 'hourCycle',
	week_start: 'weekStart'
} as const;
type Field = keyof typeof COLUMN;

/**
 * One thing about a person at a time.
 *
 * The role they are paid in, or none: which pay rules reach them follows from
 * it -- and, until pay is recorded when it is paid, so does what the reports
 * say their unpaid work pays. And what they can reach, Full or Field
 * (#lib/access): someone active keeps Full, which the database holds to. Both
 * are changed only by someone with Full.
 *
 * The rest are theirs alone, set in their profile, and refused for anyone
 * else: the zone they keep, and how their figures read -- a locale, a 12- or
 * 24-hour clock, the day their week starts. Each null follows the business's,
 * or the locale's. The zone is stored in Postgres's spelling, and only if
 * Postgres knows it -- moments are turned into days with it; the locale as Intl
 * spells it, and only if Intl can write in it.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No person with that id.');
	const fields = await readFields(request);
	const names = fields ? Object.keys(fields) : [];
	if (!fields || names.length !== 1 || !(names[0] in PERSON_FIELDS))
		return problem(
			'malformed',
			400,
			`Expected { fields: { one of ${Object.keys(PERSON_FIELDS).join(', ')}: value } }.`
		);
	const name = names[0] as Field;
	const own = (OWN_FIELDS as readonly string[]).includes(name);
	if (own && params.id !== locals.user!.id)
		return problem('notYours', 403, 'Only they can change that, in their own profile.');
	if (!own && fieldOnly(locals))
		return problem('beyondAccess', 403, 'Someone with Full changes that.');

	const raw = fields[name];
	const parsed = parsePersonField(name, typeof raw === 'string' ? raw : '');
	if (!parsed.ok) return refuse({ [name]: parsed.why });

	let value = parsed.value as string | number | null;
	if (name === 'timezone' && typeof value === 'string') {
		value = await knownZone(value);
		if (value === null) return refuse({ timezone: 'The database does not know that time zone.' });
	}

	try {
		const changed = await asUser(locals.user!.id, (tx) =>
			tx
				.update(user)
				.set({ [COLUMN[name]]: value })
				.where(eq(user.id, params.id))
				.returning({ id: user.id })
		);
		if (changed.length === 0) return problem('notFound', 404, 'No person with that id.');
	} catch (e) {
		if (pgError(e).constraint === 'someone_keeps_full')
			return refuse({ access: 'Someone has to keep Full. Give it to another person first.' });
		const refused = refuseIfTheDatabaseSaidSo(e, [name], 'user');
		if (refused) return refused;
		throw e;
	}
	return Response.json({ saved: { [name]: value } });
};
