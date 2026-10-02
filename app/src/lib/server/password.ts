import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Passwords, hashed with argon2id at the OWASP minimum, by Node itself.
 *
 * node:crypto has argon2 from Node 24.7, stable from 26, so no native module is
 * shipped for it. The hash is the standard PHC string every argon2
 * implementation reads and writes -- the same bytes @node-rs/argon2 made before
 * this, so a stored hash from either verifies under the other, and none is
 * rewritten for the change.
 *
 * The string records the parameters it was made at, which is what lets a sign-in
 * notice a hash made at older ones and replace it (rehashIfDated in ./auth.ts).
 */

const derive = promisify(argon2);

/** OWASP's minimum for argon2id: 19 MiB, two passes, one lane. */
export const ARGON = { memory: 19456, passes: 2, parallelism: 1 } as const;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

/** The header every hash made at today's parameters starts with. */
export const CURRENT_HASH = `$argon2id$v=19$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$`;

// PHC's base64: the standard alphabet with the padding left off.
const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
	const nonce = randomBytes(SALT_BYTES);
	const tag = await derive('argon2id', {
		message: password,
		nonce,
		tagLength: TAG_BYTES,
		...ARGON
	});
	return `${CURRENT_HASH}${b64(nonce)}$${b64(tag)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/**
 * Whether the password is the one this hash was made from, at whatever
 * parameters it records. Anything that is not an argon2id PHC string is a no,
 * not an error: a sign-in against it fails as a wrong password does.
 */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
	const m = PHC.exec(stored);
	if (!m) return false;
	const [, memory, passes, parallelism, salt, hash] = m;
	const expected = Buffer.from(hash, 'base64');
	try {
		const tag = await derive('argon2id', {
			message: password,
			nonce: Buffer.from(salt, 'base64'),
			tagLength: expected.length,
			memory: Number(memory),
			passes: Number(passes),
			parallelism: Number(parallelism)
		});
		return timingSafeEqual(tag, expected);
	} catch {
		return false;
	}
}
