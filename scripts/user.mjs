#!/usr/bin/env node
/**
 * The people who sign in.
 *
 *   node scripts/user.mjs list
 *   node scripts/user.mjs add avery@example.com "Avery Quinn" [--role Partner] [--full]
 *   node scripts/user.mjs invite avery@example.com
 *   node scripts/user.mjs end avery@example.com
 *
 * There is no sign-up: an open registration form on an invoicing system is a
 * liability rather than a feature. Everyone signs in with a passkey, made with
 * a link (src/lib/server/passkeys.ts). Someone with Full adds people on Team,
 * and each is emailed theirs; this is for the first person, before anyone can
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
 * passkeys does (src/lib/server/passkeys.ts endPasskeys), and emails them to
 * say so. They sign in again with a link from `invite`.
 *
 * Someone added has Field access -- the work they do, and what they are paid
 * for it -- unless --full gives them everything. The first person has Full
 * whatever is said, since someone has to: the database refuses to leave nobody
 * active on Full, and only someone with Full changes anyone's access.
 *
 * SITE_URL must be set, as it is for the server: a link begins with it, and a
 * passkey is made for that site.
 *
 * Plain JavaScript, run here as it is; a release carries it at the same path,
 * bundled with everything it imports (scripts/release-files.mjs bundleUser).
 * It connects as the server does, from the same settings
 * (#lib/server/db/defaults): .env in development, under whatever the shell
 * sets, or the host's own.
 */
// First, so .env is read before anything reads what it sets.
import { database } from './env.mjs';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { mailableLogo } from '../src/lib/server/email-layout.js';
import { EMAIL_CHANNEL, NOTICE_SENDS_FOR, passkeysEnded } from '../src/lib/server/notices.js';

const USAGE = `usage:
  node scripts/user.mjs list
  node scripts/user.mjs add <email> <name> [--role <role>] [--full]
  node scripts/user.mjs invite <email>
  node scripts/user.mjs end <email>`;

const [command, ...rest] = process.argv.slice(2);
const full = rest.includes('--full');
const roleAt = rest.indexOf('--role');
const roleName = roleAt === -1 ? null : rest[roleAt + 1];
const words = rest.filter((a, i) => !a.startsWith('--') && (roleAt === -1 || i !== roleAt + 1));
const unknown = rest.filter((a) => a.startsWith('--') && a !== '--role' && a !== '--full');
const wanted = { list: 0, add: 2, invite: 1, end: 1 }[command ?? ''];
if (
	wanted === undefined ||
	words.length !== wanted ||
	unknown.length ||
	(roleAt !== -1 && !roleName) ||
	(command !== 'add' && (full || roleAt !== -1))
) {
	console.error(USAGE);
	process.exit(1);
}

const pool = new pg.Pool({ ...database(), max: 1 });
const q = (/** @type {string} */ text, /** @type {unknown[]} */ values = []) =>
	pool.query(text, values).then((r) => r.rows);

const stop = async (/** @type {string} */ message) => {
	console.error(message);
	await pool.end();
	process.exit(1);
};

/** Where reckon is reached, as the server reads SITE_URL: its origin alone. */
function siteUrl() {
	const url = process.env.SITE_URL?.trim();
	if (!url || !URL.canParse(url)) return null;
	return new URL(url).origin;
}

/**
 * A link for `user` to make a passkey with, as src/lib/server/links.ts makes
 * one: 32 random bytes, of which only the SHA-256 is kept, good once for an
 * hour, ending any other of its kind waiting. An invitation for someone yet to
 * make a passkey, else a new link.
 *
 * @param {{ id: string, email: string }} user
 */
async function linkFor(user) {
	const site = siteUrl();
	if (!site)
		await stop(
			'SITE_URL is unset: a link begins with it, and a passkey is made for that site. Set it as the server has it.'
		);
	const [{ held }] = await q(
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
			await client.query(
				`insert into email_link (user_id, purpose, code_hash, sent_to, expires_at)
				 values ($1, $2, $3, $4, now() + interval '1 hour')
				 returning expires_at as until`,
				[user.id, purpose, createHash('sha256').update(code).digest(), user.email]
			)
		).rows;
		await client.query('commit');
		return { purpose, link: `${site}/link#${code}`, until: /** @type {Date} */ (until) };
	} catch (e) {
		await client.query('rollback');
		throw e;
	} finally {
		client.release();
	}
}

/** Says what a link is, and prints it. */
function hand(
	/** @type {{ name: string, email: string }} */ user,
	/** @type {Awaited<ReturnType<typeof linkFor>>} */ { purpose, link, until }
) {
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
			`The passkeys they have still work. If a phone or computer with one is lost or stolen, end them: node scripts/user.mjs end ${user.email}`
		);
}

/**
 * Ends every passkey `user` has and signs them out everywhere, as
 * src/lib/server/passkeys.ts endPasskeys does, and tells them once it commits
 * (src/lib/server/email.ts tell): written here, and sent by the server. How
 * many passkeys there were.
 *
 * @param {{ id: string }} user
 */
async function endPasskeys(user) {
	const client = await pool.connect();
	try {
		await client.query('begin');
		const { rowCount } = await client.query('delete from passkey where user_id = $1', [user.id]);
		await client.query('delete from session where user_id = $1', [user.id]);
		const [them] = (
			await client.query('select name, email, timezone, locale from "user" where id = $1', [
				user.id
			])
		).rows;
		const [business] = (
			await client.query(
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

if (command === 'list') {
	const people = await q(`
		select u.email, u.name, r.name as role, u.access, u.active,
		       (select count(*) from passkey p where p.user_id = u.id)::int as passkeys,
		       (select count(*) from session s where s.user_id = u.id and s.expires_at > now())::int
		         as sessions
		  from "user" u left join role r on r.id = u.role_id
		 order by u.active desc, u.name`);
	if (!people.length)
		console.log('Nobody yet. Add someone with: node scripts/user.mjs add <email> <name>');
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
} else if (command === 'add') {
	const [email, name] = [words[0].trim().toLowerCase(), words[1].trim()];
	if (!/^[^\s@]+@[^\s@]+$/.test(email)) await stop(`${words[0]} is not an email address.`);
	if (!name) await stop('A name is needed.');
	if (!siteUrl())
		await stop(
			'SITE_URL is unset: a link begins with it, and a passkey is made for that site. Set it as the server has it.'
		);
	/** @type {{ id: string, name: string } | null} */
	let role = null;
	if (roleName) {
		[role] = await q('select id, name from role where lower(name) = lower($1)', [roleName]);
		if (!role) {
			const names = (await q('select name from role order by name')).map((r) => r.name);
			await stop(`No role called ${roleName}. There is: ${names.join(', ') || 'none'}.`);
		}
	}
	const [taken] = await q('select 1 from "user" where email = $1', [email]);
	if (taken)
		await stop(
			`${email} is already somebody. To give them a link: node scripts/user.mjs invite ${email}`
		);
	// The first person has Full whether or not it was asked for.
	const [someone] = await q(`select 1 from "user" where active and access = 'full' limit 1`);
	const access = full || !someone ? 'full' : 'field';
	const [user] = await q(
		'insert into "user" (name, email, role_id, access) values ($1, $2, $3, $4) returning id, name, email',
		[name, email, role?.id ?? null, access]
	);
	console.log(
		`Added ${user.name}${role ? ` as ${role.name}` : ', with no role -- they sign in and are not paid'}, ` +
			(access === 'full'
				? `with Full access${full ? '' : ', as the first'}.`
				: 'with Field access: their own work, and what they are paid for it.')
	);
	hand(user, await linkFor(user));
} else if (command === 'invite') {
	const [user] = await q('select id, name, email, active from "user" where email = lower($1)', [
		words[0].trim()
	]);
	if (!user) await stop(`Nobody has the email ${words[0]}.`);
	if (!user.active) await stop(`${user.name} is deactivated. Reactivate them on Team first.`);
	hand(user, await linkFor(user));
} else {
	const [user] = await q(
		`select id, name, email,
		        exists (select 1 from passkey where user_id = "user".id) as keyed
		   from "user" where email = lower($1)`,
		[words[0].trim()]
	);
	if (!user) await stop(`Nobody has the email ${words[0]}.`);
	if (!user.keyed) await stop(`${user.name} has no passkey to end.`);
	const ended = await endPasskeys(user);
	console.log(
		`${user.name}'s ${ended === 1 ? 'passkey is' : `${ended} passkeys are`} ended, and they are signed out everywhere. They are emailed to say so. To sign in again they need a new link: node scripts/user.mjs invite ${user.email}`
	);
}

await pool.end();
