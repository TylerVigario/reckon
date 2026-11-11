import { eq, sql } from 'drizzle-orm';
import { asUser, type Tx } from '#lib/server/db/index.ts';
import { passkey, session, user } from '#lib/server/db/schema/index.ts';
import { tell } from '#lib/server/email.ts';
import { cannotSend, endChange, issue, unsentBecause } from '#lib/server/links.ts';
import { emailChange, emailChanging, invitation } from '#lib/server/notices.js';
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
 * may have -- a new one waits to be proven theirs (changeEmail). Whether they
 * can sign in: deactivated, they can't, and aren't
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

	if (name === 'email') return changeEmail(params.id, value as string, locals.user!);

	try {
		const changed = await asUser(locals.user!.id, async (tx) => {
			const rows = await tx
				.update(user)
				.set({ [COLUMN[name]]: value })
				.where(eq(user.id, params.id))
				.returning({ id: user.id });
			// Deactivated, they are signed out everywhere in the same step, and
			// refused a session after (#lib/server/passkeys mayOpenSession).
			if (rows.length && name === 'active' && value === false)
				await tx.delete(session).where(eq(session.userId, params.id));
			return rows;
		});
		if (changed.length === 0) return problem('notFound', 404, 'No person with that id.');
	} catch (e) {
		const { constraint } = pgError(e);
		if (constraint === 'someone_keeps_full')
			return refuse({ [name]: 'Someone has to keep Full. Give it to another person first.' });
		const refused = refuseIfTheDatabaseSaidSo(e, [name], 'user');
		if (refused) return refused;
		throw e;
	}
	return Response.json({ saved: { [name]: value } });
};

const TAKEN = 'Someone else signs in with that email.';

/**
 * A NEW ADDRESS for someone. Someone who can sign in -- active, and signed in
 * before or holding a passkey -- keeps the one they have until
 * they use a link sent to the new one, which then becomes theirs, confirmed
 * (SP 800-63B-4 §4.2.1.2; OWASP's Authentication Cheat Sheet: "Store the
 * proposed new email address as a pending change"). The address they have now
 * is told at once: who asked, and for what (ASVS 5.0 6.3.7; SP 800-63B-4
 * §4.6). A newer change ends one still waiting.
 *
 * Anyone else's changes at once, unconfirmed. Someone yet to accept their
 * invitation is sent it again, at the new address, and using it proves that;
 * someone deactivated is told nothing, since they sign in to nothing.
 */
async function changeEmail(
	id: string,
	to: string,
	me: { id: string; name: string }
): Promise<Response> {
	try {
		return await asUser(me.id, async (tx) => {
			const [person] = await tx
				.select({
					email: user.email,
					active: user.active,
					joined: user.lastSignedInAt,
					// "user" outright: Drizzle leaves a column unqualified in a query of one
					// table, and inside this it would be read as passkey's own.
					held: sql<boolean>`exists (select 1 from ${passkey} where ${passkey.userId} = "user".id)`
				})
				.from(user)
				.where(eq(user.id, id))
				.for('update');
			if (!person) return problem('notFound', 404, 'No person with that id.');
			if (person.email === to) return Response.json({ saved: { email: to } });

			const canSignIn = person.active && (person.joined !== null || person.held);
			if (!canSignIn) {
				await tx.update(user).set({ email: to, emailVerified: false }).where(eq(user.id, id));
				await endChange(tx, id);
				await inviteAgain(tx, id, me);
				return Response.json({ saved: { email: to } });
			}

			const missing = cannotSend();
			if (missing)
				return refuse({
					email: `${unsentBecause(missing)} A new address can’t be confirmed without it.`
				});
			const [taken] = await tx.select({ id: user.id }).from(user).where(eq(user.email, to));
			if (taken) return refuse({ email: TAKEN });
			const by = me.id === id ? null : me.name;
			const sent = await issue(tx, id, 'change', me.id, to);
			await tell(
				tx,
				id,
				(them, business) => emailChange(them, business, { by, ...sent }),
				sent.until
			);
			await tell(tx, id, (them, business) =>
				emailChanging(them, business, { at: new Date(), by, to })
			);
			return Response.json({ waiting: { to, until: sent.until } }, { status: 202 });
		});
	} catch (e) {
		if (pgError(e).constraint === 'user_email_key') return refuse({ email: TAKEN });
		throw e;
	}
}

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
			// "user" outright: Drizzle leaves a column unqualified in a query of one
			// table, and inside this it would be read as passkey's own.
			held: sql<boolean>`exists (select 1 from ${passkey} where ${passkey.userId} = "user".id)`
		})
		.from(user)
		.where(eq(user.id, userId));
	if (!person?.active || person.joined || person.held) return;
	const sent = await issue(tx, userId, 'invite', me.id);
	await tell(
		tx,
		userId,
		(them, business) => invitation(them, business, { by: me.name, ...sent }),
		sent.until
	);
}
