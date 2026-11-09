import { and, eq, sql } from 'drizzle-orm';
import { asUser, type Tx } from '#lib/server/db/index.ts';
import { account, session, user } from '#lib/server/db/schema/index.ts';
import { tell } from '#lib/server/email.ts';
import { cannotSend, issue } from '#lib/server/links.ts';
import { invitation } from '#lib/server/notices.js';
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
	name: 'name',
	email: 'email',
	active: 'active',
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
 * Who they are: their name, and the email they sign in with, which no one else
 * may have. A new address is not confirmed until they use a link sent there
 * (#lib/server/links), and one waiting at the old address stops working;
 * someone yet to choose their first password is sent their invitation again,
 * to the new one. Whether they can sign in: deactivated, they can't, and aren't
 * offered work, though everything they did is kept -- and nobody deactivates
 * themselves, which would sign them out of the screen they did it on.
 *
 * The role they are paid in, or none: which pay rules reach them follows from
 * it -- and, until pay is recorded when it is paid, so does what the reports
 * say their unpaid work pays. And what they can reach, Full or Field
 * (#lib/access): someone active keeps Full, which the database holds to. All
 * of these are changed only by someone with Full, on Team.
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

	let value = parsed.value;
	if (name === 'active' && value === false && params.id === locals.user!.id)
		return refuse({ active: "You can't deactivate yourself. Someone else with Full can." });
	if (name === 'timezone' && typeof value === 'string') {
		value = await knownZone(value);
		if (value === null) return refuse({ timezone: 'The database does not know that time zone.' });
	}

	try {
		const changed = await asUser(locals.user!.id, async (tx) => {
			const [was] = await tx
				.select({ email: user.email })
				.from(user)
				.where(eq(user.id, params.id))
				.for('update');
			const done = await tx
				.update(user)
				.set({
					[COLUMN[name]]: value,
					// Proven was the address before; a new one is not, yet.
					...(name === 'email' && was && was.email !== value && { emailVerified: false })
				})
				.where(eq(user.id, params.id))
				.returning({ id: user.id });
			if (done.length && name === 'email' && was && was.email !== value)
				await inviteAgain(tx, params.id, locals.user!);
			return done;
		});
		if (changed.length === 0) return problem('notFound', 404, 'No person with that id.');
	} catch (e) {
		const { constraint } = pgError(e);
		if (constraint === 'someone_keeps_full')
			return refuse({ [name]: 'Someone has to keep Full. Give it to another person first.' });
		if (constraint === 'user_email_key')
			return refuse({ email: 'Someone else signs in with that email.' });
		const refused = refuseIfTheDatabaseSaidSo(e, [name], 'user');
		if (refused) return refused;
		throw e;
	}
	return Response.json({ saved: { [name]: value } });
};

/**
 * Someone yet to choose their first password, whose address was corrected,
 * is invited again at the new one -- where reckon can send it. Otherwise their
 * invitation lapses with the old address, and Team says so.
 */
async function inviteAgain(tx: Tx, userId: string, me: { id: string; name: string }) {
	if (cannotSend()) return;
	const [person] = await tx
		.select({
			active: user.active,
			joined: user.lastSignedInAt,
			temporary: user.temporaryPassword,
			// "user" outright: Drizzle leaves a column unqualified in a query of one
			// table, and inside this it would be read as account's own.
			held: sql<boolean>`exists (select 1 from ${account} where ${account.userId} = "user".id and ${account.providerId} = 'credential')`
		})
		.from(user)
		.where(eq(user.id, userId));
	if (!person?.active || person.joined || (person.held && !person.temporary)) return;
	// A temporary password handed over before invitations stops working, as
	// sending the invitation again on Team stops it (../invitation).
	if (person.held) {
		await tx
			.delete(account)
			.where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
		await tx.update(user).set({ temporaryPassword: false }).where(eq(user.id, userId));
		await tx.delete(session).where(eq(session.userId, userId));
	}
	const sent = await issue(tx, userId, 'invite', me.id);
	await tell(
		tx,
		userId,
		(them, business) => invitation(them, business, { by: me.name, ...sent }),
		sent.until
	);
}
