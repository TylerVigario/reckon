import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { hashPassword } from './auth.ts';
import type { Tx } from './db/index.ts';
import { account, session, user } from './db/schema/index.ts';
import { passwordSet } from './sign-in-limit.ts';
import { WORDS } from './words.ts';

/**
 * A PASSWORD HANDED OVER. reckon sends no email, so whoever adds a person, or
 * resets their password, on Team is shown one once, to give them by voice or on
 * paper. Until they choose their own it reaches nothing but the page where they
 * do (/new-password), and that is the whole of its use.
 *
 * Four words, so it is read out and typed without spelling it: about 41 bits,
 * against a sign-in that limits tries per address and per email and stops a
 * password at a hundred wrong in a row, and kept as the same argon2id hash as
 * any other.
 */
export async function temporaryPassword(): Promise<{ password: string; hash: string }> {
	const password = Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]).join('-');
	return { password, hash: await hashPassword(password) };
}

/**
 * Makes `hash` the person's password, temporary, and signs them out everywhere:
 * a reset that left a session alive would have changed nothing for whoever
 * holds it. A password stopped by wrong tries works again, as the new one
 * (#lib/server/sign-in-limit).
 */
export async function handOver(tx: Tx, userId: string, hash: string): Promise<void> {
	const credential = and(eq(account.userId, userId), eq(account.providerId, 'credential'));
	const updated = await tx
		.update(account)
		.set({ password: hash })
		.where(credential)
		.returning({ id: account.id });
	// A password account names its person by their own id, as Better Auth's do.
	if (updated.length === 0)
		await tx
			.insert(account)
			.values({ userId, accountId: userId, providerId: 'credential', password: hash });
	await tx
		.update(user)
		.set({ temporaryPassword: true, ...passwordSet() })
		.where(eq(user.id, userId));
	await tx.delete(session).where(eq(session.userId, userId));
}
