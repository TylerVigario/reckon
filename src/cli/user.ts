/**
 * THE PEOPLE WHO SIGN IN, from the host.
 *
 * There is no sign-up: an open registration form on an invoicing system is a
 * liability rather than a feature. Everyone signs in with a passkey, made with
 * a link (#lib/server/passkeys). Someone with Full adds people on Team, and
 * each is emailed theirs; this is for the first person, before anyone can
 * sign in to do that, and for anyone else, when nobody who could is able to or
 * reckon has no email to send by.
 *
 * `add` makes the person and gives a link to make their first passkey with.
 * `invite` gives a link again: an invitation, for someone yet to make one, or
 * a new link, for someone who can't sign in -- the only one with Full, say --
 * which adds a passkey and ends none. Either is printed here, to hand to them
 * or to open yourself, and works once, for an hour; whoever has it can make a
 * passkey for that person, so it goes to nobody else. A newer link ends any
 * earlier one still waiting.
 *
 * `end` ends every passkey someone has and signs them out everywhere, for a
 * phone or computer of theirs that is lost or stolen, as Team's End their
 * passkeys does (#lib/server/passkeys endPasskeys), and emails them to say so.
 * They sign in again with a link from `invite`.
 *
 * Someone added has Field access -- the work they do, and what they are paid
 * for it -- unless --full gives them everything. The first person has Full
 * whatever is said, since someone has to: the database refuses to leave nobody
 * active on Full, and only someone with Full changes anyone's access.
 *
 * SITE_URL must be set, as it is for the server: a link begins with it, and a
 * passkey is made for that site.
 */
import { createHash, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { mailableLogo } from '#lib/server/email-layout.js';
import { EMAIL_CHANNEL, NOTICE_SENDS_FOR, passkeysEnded } from '#lib/server/notices.js';
import { Failed, operands, Usage, type Command } from './command.ts';

const usage = `usage: bin/reckon user list
       bin/reckon user add <email> <name> [--role <role>] [--full]
       bin/reckon user invite <email>
       bin/reckon user end <email>`;

/**
 * How the security log (#lib/server/events) knows a row came from here, on the
 * host, which has no request to say where from. Rows from before this command
 * say `scripts/user.mjs`, and stand as they were written
 * (#lib/server/security-log).
 */
export const VIA = 'reckon user';

export const user: Command = {
	summary: 'the people who sign in: list, add, invite, end',
	usage,
	help: `${usage}

  list     everyone, with their access, passkeys and sessions
  add      someone new, with Field access unless --full, and as --role if
           given; prints a link for their first passkey
  invite   prints a link for someone to make a passkey with: their first, or
           a new one where they can't sign in
  end      ends every passkey someone has and signs them out everywhere, for
           a phone or computer that is lost or stolen

A link works once, for an hour, and whoever has it can make a passkey for that
person: give it to them alone. The first person added has Full, since someone
has to. SITE_URL must be set, as the server has it: a link begins with it.`,

	async run(args, { database }) {
		const [command, ...rest] = args;
		if (command === 'add') {
			const { values, positionals } = parseArgs({
				args: rest,
				options: { role: { type: 'string' }, full: { type: 'boolean', default: false } },
				allowPositionals: true
			});
			const [email, name] = operands(positionals, 2, 'add takes an email and a name.');
			if (values.role !== undefined && !values.role.trim())
				throw new Usage('--role takes the name of a role.');
			return withPeople(database(), (people) => add(people, email, name, values));
		}
		const takes = {
			list: [0, 'list takes nothing.'],
			invite: [1, 'invite takes an email.'],
			end: [1, 'end takes an email.']
		} as const;
		if (command === 'list' || command === 'invite' || command === 'end') {
			const { positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true });
			const [count, what] = takes[command];
			const [email] = operands(positionals, count, what);
			return withPeople(database(), (people) =>
				command === 'list'
					? list(people)
					: command === 'invite'
						? invite(people, email)
						: end(people, email)
			);
		}
		throw new Usage(
			command === undefined
				? 'Which: list, add, invite or end?'
				: `There is no user ${command}: list, add, invite or end.`
		);
	}
};

type Rows = <R extends pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<R[]>;
type People = { pool: pg.Pool; q: Rows };

/** Runs `then` connected as the server is, and lets go of the connection after. */
async function withPeople(
	where: pg.ClientConfig,
	then: (people: People) => Promise<void>
): Promise<number> {
	const pool = new pg.Pool({ ...where, max: 1 });
	const q: Rows = <R extends pg.QueryResultRow>(text: string, values: unknown[] = []) =>
		pool.query<R>(text, values).then((r) => r.rows);
	try {
		await then({ pool, q });
		return 0;
	} finally {
		await pool.end();
	}
}

/**
 * A row of the security log, as the server writes one: named as it names
 * them, whom it is about, and that it came from here.
 */
const record = (
	to: Pick<pg.Pool | pg.PoolClient, 'query'>,
	name: string,
	userId: string,
	detail: Record<string, string | number> = {}
) =>
	to.query('insert into security_event (name, user_id, detail) values ($1, $2, $3)', [
		name,
		userId,
		JSON.stringify({ ...detail, via: VIA })
	]);

/** Where reckon is reached, as the server reads SITE_URL: its origin alone. */
function siteUrl(): string {
	const url = process.env.SITE_URL?.trim();
	if (!url || !URL.canParse(url))
		throw new Failed(
			'SITE_URL is unset: a link begins with it, and a passkey is made for that site. Set it as the server has it.'
		);
	return new URL(url).origin;
}

type Link = { purpose: 'invite' | 'reset'; link: string; until: Date };

/**
 * A link for `user` to make a passkey with, as #lib/server/links makes one:
 * 32 random bytes, of which only the SHA-256 is kept, good once for an hour,
 * ending any other of its kind waiting. An invitation for someone yet to make
 * a passkey, else a new link.
 */
async function linkFor({ pool, q }: People, user: { id: string; email: string }): Promise<Link> {
	const site = siteUrl();
	const [{ held }] = await q<{ held: boolean }>(
		`select exists (select 1 from passkey where user_id = $1)
		     or (select last_signed_in_at is not null from "user" where id = $1) as held`,
		[user.id]
	);
	const purpose = held ? 'reset' : 'invite';
	const code = randomBytes(32).toString('base64url');
	const client = await pool.connect();
	try {
		await client.query('begin');
		await client.query(
			`delete from email_link
			  where user_id = $1 and used_at is null and purpose in ('invite', 'reset')`,
			[user.id]
		);
		const [{ until }] = (
			await client.query<{ until: Date }>(
				`insert into email_link (user_id, purpose, code_hash, sent_to, expires_at)
				 values ($1, $2, $3, $4, now() + interval '1 hour')
				 returning expires_at as until`,
				[user.id, purpose, createHash('sha256').update(code).digest(), user.email]
			)
		).rows;
		await record(client, 'authn_link_issued', user.id, { purpose });
		await client.query('commit');
		return { purpose, link: `${site}/link#${code}`, until };
	} catch (e) {
		await client.query('rollback');
		throw e;
	} finally {
		client.release();
	}
}

/** Says what a link is, and prints it. */
function hand(user: { name: string; email: string }, { purpose, link, until }: Link) {
	console.log(
		purpose === 'invite'
			? `${user.name} makes their first passkey with this link:`
			: `${user.name} makes a new passkey with this link:`
	);
	console.log(`\n  ${link}\n`);
	console.log(
		`It works once, until ${until.toLocaleString()}. Whoever has it can make a passkey for ${user.name}: give it to them alone, or open it yourself if it is yours.`
	);
	if (purpose === 'reset')
		console.log(
			`The passkeys they have still work. If a phone or computer with one is lost or stolen, end them: bin/reckon user end ${user.email}`
		);
}

async function list({ q }: People) {
	const people = await q<{
		email: string;
		name: string;
		role: string | null;
		access: 'full' | 'field';
		active: boolean;
		passkeys: number;
		sessions: number;
	}>(`
		select u.email, u.name, r.name as role, u.access, u.active,
		       (select count(*) from passkey p where p.user_id = u.id)::int as passkeys,
		       (select count(*) from session s where s.user_id = u.id and s.expires_at > now())::int
		         as sessions
		  from "user" u left join role r on r.id = u.role_id
		 order by u.active desc, u.name`);
	if (!people.length)
		console.log('Nobody yet. Add someone with: bin/reckon user add <email> <name>');
	for (const p of people)
		console.log(
			[
				p.email,
				p.name,
				p.role ?? 'no role',
				p.access === 'full' ? 'Full' : 'Field',
				p.active ? 'active' : 'inactive',
				p.passkeys ? `${p.passkeys} passkey(s)` : 'NO PASSKEY',
				`${p.sessions} session(s)`
			].join(' · ')
		);
}

async function add(
	people: People,
	typedEmail: string,
	typedName: string,
	{ role: roleName, full }: { role?: string; full: boolean }
) {
	const { q } = people;
	const [email, name] = [typedEmail.trim().toLowerCase(), typedName.trim()];
	if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Failed(`${typedEmail} is not an email address.`);
	if (!name) throw new Failed('A name is needed.');
	siteUrl();
	let role: { id: string; name: string } | null = null;
	if (roleName !== undefined) {
		[role] = await q<{ id: string; name: string }>(
			'select id, name from role where lower(name) = lower($1)',
			[roleName]
		);
		if (!role) {
			const names = (await q<{ name: string }>('select name from role order by name')).map(
				(r) => r.name
			);
			throw new Failed(`No role called ${roleName}. There is: ${names.join(', ') || 'none'}.`);
		}
	}
	const [taken] = await q('select 1 from "user" where email = $1', [email]);
	if (taken)
		throw new Failed(
			`${email} is already somebody. To give them a link: bin/reckon user invite ${email}`
		);
	// The first person has Full whether or not it was asked for.
	const [someone] = await q(`select 1 from "user" where active and access = 'full' limit 1`);
	const access = full || !someone ? 'full' : 'field';
	const [made] = await q<{ id: string; name: string; email: string }>(
		'insert into "user" (name, email, role_id, access) values ($1, $2, $3, $4) returning id, name, email',
		[name, email, role?.id ?? null, access]
	);
	await record(people.pool, 'user_created', made.id, { access });
	console.log(
		`Added ${made.name}${role ? ` as ${role.name}` : ', with no role -- they sign in and are not paid'}, ` +
			(access === 'full'
				? `with Full access${full ? '' : ', as the first'}.`
				: 'with Field access: their own work, and what they are paid for it.')
	);
	hand(made, await linkFor(people, made));
}

async function invite(people: People, typed: string) {
	const [found] = await people.q<{ id: string; name: string; email: string; active: boolean }>(
		'select id, name, email, active from "user" where email = lower($1)',
		[typed.trim()]
	);
	if (!found) throw new Failed(`Nobody has the email ${typed}.`);
	if (!found.active)
		throw new Failed(`${found.name} is deactivated. Reactivate them on Team first.`);
	hand(found, await linkFor(people, found));
}

async function end(people: People, typed: string) {
	const [found] = await people.q<{ id: string; name: string; email: string; keyed: boolean }>(
		`select id, name, email,
		        exists (select 1 from passkey where user_id = "user".id) as keyed
		   from "user" where email = lower($1)`,
		[typed.trim()]
	);
	if (!found) throw new Failed(`Nobody has the email ${typed}.`);
	if (!found.keyed) throw new Failed(`${found.name} has no passkey to end.`);
	const ended = await endPasskeys(people, found);
	console.log(
		`${found.name}'s ${ended === 1 ? 'passkey is' : `${ended} passkeys are`} ended, and they are signed out everywhere. They are emailed to say so. To sign in again they need a new link: bin/reckon user invite ${found.email}`
	);
}

/**
 * Ends every passkey `user` has and signs them out everywhere, as
 * #lib/server/passkeys endPasskeys does, and tells them once it commits
 * (#lib/server/email tell): written here, and sent by the server. How many
 * passkeys there were.
 */
async function endPasskeys({ pool }: People, user: { id: string }): Promise<number> {
	const client = await pool.connect();
	try {
		await client.query('begin');
		const { rowCount } = await client.query('delete from passkey where user_id = $1', [user.id]);
		if (rowCount)
			await record(client, 'authn_passkey_removed', user.id, { passkeys: rowCount, why: 'ended' });
		const signedOut = await client.query('delete from session where user_id = $1', [user.id]);
		if (signedOut.rowCount)
			await record(client, 'session_expired', user.id, {
				sessions: signedOut.rowCount,
				why: 'their passkeys were ended'
			});
		const [them] = (
			await client.query<{
				name: string;
				email: string;
				timezone: string | null;
				locale: string | null;
			}>('select name, email, timezone, locale from "user" where id = $1', [user.id])
		).rows;
		const [business] = (
			await client.query<{
				tradingName: string | null;
				shortName: string | null;
				email: string | null;
				phone: string | null;
				timezone: string | null;
				locale: string | null;
				accentColour: string | null;
				logo: Uint8Array | null;
				logoMediaType: string | null;
			}>(
				`select trading_name as "tradingName", short_name as "shortName", email, phone,
				        timezone, locale, accent_colour as "accentColour", logo,
				        logo_media_type as "logoMediaType"
				   from operator limit 1`
			)
		).rows;
		const { logo, logoMediaType, ...rest } = business ?? {};
		const notice = passkeysEnded(
			them,
			{ ...rest, logo: mailableLogo(logo, logoMediaType) },
			{ at: new Date(), by: null }
		);
		await client.query(
			`insert into email_message (kind, user_id, to_address, subject, body, html, send_by)
			 values ($1, $2, $3, $4, $5, $6, now() + $7::interval)`,
			[notice.kind, user.id, notice.to, notice.subject, notice.body, notice.html, NOTICE_SENDS_FOR]
		);
		await client.query('select pg_notify($1, $2)', [EMAIL_CHANNEL, '']);
		await client.query('commit');
		return rowCount ?? 0;
	} catch (e) {
		await client.query('rollback');
		throw e;
	} finally {
		client.release();
	}
}
