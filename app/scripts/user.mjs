#!/usr/bin/env node
/**
 * The people who sign in.
 *
 *   node scripts/user.mjs list
 *   node scripts/user.mjs add avery@example.com "Avery Quinn" [--role Partner]
 *   node scripts/user.mjs password avery@example.com [--insecure]
 *
 * There is no sign-up: everyone who signs in is added here, and an open
 * registration form on an invoicing system is a liability rather than a
 * feature. `add` makes the person and asks for their password straight away;
 * `password` sets a new one. A password is prompted for rather than passed as
 * an argument, so it never reaches shell history or the process list.
 *
 * The rule is checked on the first entry, before the second is asked for: typing
 * a password twice only to be told the first was too short is two wasted
 * entries. --insecure lifts the rule, for a development database where the
 * password guards nothing; it still says so when it is used.
 *
 * Every existing session for that person is ended, because a password change
 * that leaves old sessions alive has not changed anything for whoever holds one.
 *
 * Plain JavaScript, so a release can run it with no build step. It connects as
 * the app does: DATABASE_URL, or the local socket and PGDATABASE.
 */
import { argon2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { stdin, stdout } from 'node:process';

const USAGE = `usage:
  node scripts/user.mjs list
  node scripts/user.mjs add <email> <name> [--role <role>] [--insecure]
  node scripts/user.mjs password <email> [--insecure]`;

const [command, ...rest] = process.argv.slice(2);
const insecure = rest.includes('--insecure');
const roleAt = rest.indexOf('--role');
const roleName = roleAt === -1 ? null : rest[roleAt + 1];
const words = rest.filter((a, i) => !a.startsWith('--') && (roleAt === -1 || i !== roleAt + 1));
const unknown = rest.filter((a) => a.startsWith('--') && a !== '--insecure' && a !== '--role');
const wanted = { list: 0, add: 2, password: 1 }[command ?? ''];
if (
	wanted === undefined ||
	words.length !== wanted ||
	unknown.length ||
	(roleAt !== -1 && !roleName)
) {
	console.error(USAGE);
	process.exit(1);
}

/** The same minimum as src/lib/server/auth.ts (MIN_PASSWORD_LENGTH). */
const MIN = 12;

/**
 * The same parameters as src/lib/server/password.ts, and the same PHC
 * string, made with node:crypto as the server makes it. Restated here because a
 * release ships this script without src/; a sign-in rehashes anything older, so
 * the two drifting apart costs one rewrite, not a lockout.
 */
const ARGON = { memory: 19456, passes: 2, parallelism: 1 };
const derive = promisify(argon2);
const b64 = (/** @type {Buffer} */ b) => b.toString('base64').replace(/=+$/, '');
/** @param {string} password */
async function hash(password) {
	const nonce = randomBytes(16);
	const tag = await derive('argon2id', { message: password, nonce, tagLength: 32, ...ARGON });
	return `$argon2id$v=19$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${b64(nonce)}$${b64(tag)}`;
}

/**
 * Prompts without echoing. A password on screen is a password over a shoulder.
 *
 * Raw mode: the keys are read directly, so nothing typed is echoed.
 */
/** @type {Promise<string[]> | null} */
let piped = null;

// Anything typed or pasted past the Enter that ended the last prompt. A paste
// delivers both passwords in one chunk, and without this the second prompt
// would be answered by whatever was left of the first -- or by nothing.
let carry = '';

/**
 * @param {string} prompt
 * @returns {Promise<string>}
 */
function secret(prompt) {
	return new Promise((resolve, reject) => {
		stdout.write(prompt);

		const take = (/** @type {string} */ text) => {
			const i = text.search(/[\r\n]/);
			if (i === -1) return null;
			carry = text.slice(i + 1).replace(/^[\r\n]/, '');
			return text.slice(0, i);
		};

		const ready = take(carry);
		if (ready !== null) {
			stdout.write('\n');
			return resolve(ready);
		}

		// Piped input has no keys to read raw. stdin can only be drained once,
		// and there are two prompts, so it is read whole and handed out a line
		// at a time -- otherwise the second prompt waits on a stream that ended.
		if (!stdin.isTTY) {
			piped ??= new Promise((res) => {
				let buf = '';
				stdin.setEncoding('utf8');
				stdin.on('data', (/** @type {string} */ d) => (buf += d));
				stdin.on('end', () => res(buf.split('\n')));
			});
			void piped.then((lines) => {
				stdout.write('\n');
				resolve(lines.shift() ?? '');
			});
			return;
		}

		const wasRaw = stdin.isRaw;
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding('utf8');

		let buf = carry;
		carry = '';
		const done = (/** @type {(v: any) => void} */ fn, /** @type {string | Error} */ arg) => {
			stdin.removeListener('data', onData);
			stdin.setRawMode(wasRaw);
			stdin.pause();
			stdout.write('\n');
			fn(arg);
		};

		const onData = (/** @type {string} */ chunk) => {
			for (let i = 0; i < chunk.length; i++) {
				const ch = chunk[i];
				if (ch === '\r' || ch === '\n' || ch === '\u0004') {
					// Whatever came after the Enter belongs to the next prompt.
					carry = chunk.slice(i + 1).replace(/^[\r\n]/, '');
					return done(resolve, buf);
				}
				if (ch === '\u0003') return done(reject, new Error('cancelled'));
				if (ch === '\u007f' || ch === '\b') {
					buf = buf.slice(0, -1);
					continue;
				}
				// Ignore escape sequences -- an arrow key should not land in a
				// password as three characters nobody typed.
				if (ch === '\u001b') return;
				buf += ch;
			}
		};

		stdin.on('data', onData);
	});
}

const pool = process.env.DATABASE_URL
	? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
	: new pg.Pool({
			host: process.env.PGHOST ?? '/var/run/postgresql',
			database: process.env.PGDATABASE ?? 'reckon_dev',
			max: 1
		});
const q = (/** @type {string} */ text, /** @type {unknown[]} */ values = []) =>
	pool.query(text, values).then((r) => r.rows);

const stop = async (/** @type {string} */ message) => {
	console.error(message);
	await pool.end();
	process.exit(1);
};

/**
 * Why a password is refused, or null. Empty is refused even under --insecure:
 * that is not a weak password, it is none.
 *
 * @param {string} p
 */
const refusal = (p) =>
	p.length === 0
		? 'A password cannot be empty.'
		: !insecure && p.length < MIN
			? `Twelve characters at least -- or pass --insecure for a development database.`
			: null;

/**
 * Asks for a password twice and stores its hash as the person's credential
 * account, ending every session they hold.
 *
 * @param {{ id: string, name: string }} user
 */
async function setPassword(user) {
	// A terminal can be asked again; piped input has only the lines it was
	// given, so there a refusal ends it -- still before the second line is read.
	const retry = stdin.isTTY;

	/** @type {string} */
	let first;
	for (;;) {
		first = await secret(`Password for ${user.name}: `);
		const why = refusal(first);
		if (!why) {
			const again = await secret('Again: ');
			if (again === first) break;
			if (!retry) await stop('They differ. Nothing changed.');
			console.error('They differ. Once more.');
			continue;
		}
		if (!retry) await stop(`${why} Nothing changed.`);
		console.error(why);
	}

	if (insecure && first.length < MIN)
		console.error(
			`Insecure: ${first.length} character(s). Fine for a development database, not for one anybody else signs in to.`
		);

	const password = await hash(first);
	const client = await pool.connect();
	try {
		await client.query('begin');
		const { rowCount } = await client.query(
			`update account set password = $2, updated_at = now()
			  where user_id = $1 and provider_id = 'credential'`,
			[user.id, password]
		);
		// A password account names its person by their own id, as Better Auth's do.
		if (!rowCount)
			await client.query(
				`insert into account (user_id, account_id, provider_id, password)
				 values ($1::uuid, $1::text, 'credential', $2)`,
				[user.id, password]
			);
		const gone = await client.query('delete from session where user_id = $1', [user.id]);
		await client.query('commit');
		return gone.rowCount ?? 0;
	} catch (e) {
		await client.query('rollback');
		throw e;
	} finally {
		client.release();
	}
}

if (command === 'list') {
	const people = await q(`
		select u.email, u.name, r.name as role, u.active,
		       exists (select 1 from account a
		                where a.user_id = u.id and a.provider_id = 'credential'
		                  and a.password is not null) as can_sign_in,
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
				p.active ? 'active' : 'inactive',
				p.can_sign_in ? 'has a password' : 'NO PASSWORD',
				`${p.sessions} session(s)`
			].join(' · ')
		);
} else if (command === 'add') {
	const [email, name] = [words[0].trim().toLowerCase(), words[1].trim()];
	if (!/^[^\s@]+@[^\s@]+$/.test(email)) await stop(`${words[0]} is not an email address.`);
	if (!name) await stop('A name is needed.');
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
			`${email} is already somebody. To change their password: node scripts/user.mjs password ${email}`
		);
	const [user] = await q(
		'insert into "user" (name, email, role_id) values ($1, $2, $3) returning id, name',
		[name, email, role?.id ?? null]
	);
	await setPassword(user);
	console.log(
		`Added ${user.name}${role ? ` as ${role.name}` : ', with no role -- they sign in and are not paid'}.`
	);
} else {
	const [user] = await q('select id, name from "user" where email = lower($1)', [words[0].trim()]);
	if (!user) await stop(`Nobody has the email ${words[0]}.`);
	const ended = await setPassword(user);
	console.log(`Set for ${user.name}. ${ended} existing session(s) ended.`);
}

await pool.end();
