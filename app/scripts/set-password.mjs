#!/usr/bin/env node
/**
 * Sets a person's password.
 *
 *   node scripts/set-password.mjs tyler@example.com
 *
 * There is no sign-up: two people, both already rows in app_user, and an open
 * registration form on an invoicing system is a liability rather than a
 * feature. The password is prompted for rather than passed as an argument, so
 * it never reaches shell history or the process list.
 *
 * Every existing session for that person is ended, because a password change
 * that leaves old sessions alive has not changed anything for whoever holds one.
 */
import { hash } from '@node-rs/argon2';
import postgres from 'postgres';
import { stdin, stdout } from 'node:process';

const email = process.argv[2];
if (!email) {
	console.error('usage: node scripts/set-password.mjs <email>');
	process.exit(1);
}

/**
 * Prompts without echoing. A password on screen is a password over a shoulder.
 *
 * Raw mode rather than readline. readline owns the terminal and echoes through
 * its own writer, and muting that by replacing `output.write` does not mute it
 * -- it breaks the refresh logic and the prompt never returns. Reading the keys
 * directly is both simpler and the thing that actually works.
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

const sql = postgres({
	host: process.env.PGHOST ?? '/var/run/postgresql',
	database: process.env.PGDATABASE ?? 'reckon_dev'
});

const stop = async (/** @type {string} */ message) => {
	console.error(message);
	await sql.end();
	process.exit(1);
};

const [user] = await sql`select id, name from app_user where lower(email) = lower(${email})`;
if (!user) await stop(`no app_user with email ${email}`);

const first = await secret(`Password for ${user.name}: `);
const again = await secret('Again: ');

if (first !== again) await stop('They differ. Nothing changed.');
if (first.length < 12) await stop('Twelve characters at least. Nothing changed.');

const credential = await hash(first, {
	algorithm: 2,
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1
});

await sql`
	update app_user
	   set credential = ${credential}, failed_attempts = 0, locked_until = null
	 where id = ${user.id}`;
const gone = await sql`delete from session where user_id = ${user.id} returning 1`;

console.log(`Set for ${user.name}. ${gone.length} existing session(s) ended.`);
await sql.end();
