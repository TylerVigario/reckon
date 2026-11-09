import { createHmac } from 'node:crypto';
import { normalizeIP } from '@better-auth/core/utils/ip';
import { and, count, desc, eq, gt, isNull, lt, max, sql, type SQL } from 'drizzle-orm';
import { authSecret } from './auth.ts';
import { db, type Tx } from './db/index.ts';
import { signInTry, user, type TRY_OUTCOMES, type TRY_PAGES } from './db/schema/index.ts';

/**
 * How many tries at a password are allowed, worked out from the record of every
 * try (sign_in_try), as Authelia and django-axes work theirs out. Better Auth's
 * own limiter runs only on its HTTP routes, which this app does not mount --
 * sign-in is a form action calling Better Auth directly -- so the limits live
 * here.
 *
 * PER ADDRESS, five tries in fifteen minutes. An IPv6 address counts as its
 * /64, as Better Auth's own limiter keys it: a /64 is one network, and a client
 * on it may take any of its addresses, so counted one by one it would never run
 * out of tries.
 *
 * PER EMAIL, ten wrong in a row from anywhere, and then each try waits twice as
 * long as the last, from thirty seconds to an hour (NIST SP 800-63B-4 §3.2.2),
 * since many addresses could each take five. A browser that has signed in as
 * that person (#lib/server/signed-in-here) keeps a count of its own, so a
 * stranger's tries never make it wait.
 *
 * A HUNDRED WRONG IN A ROW stop the password: it is not checked again until a
 * new one is set, on Team by someone else with Full or with scripts/user.mjs.
 * The stop is saved on the person, so the record ageing out never undoes it.
 *
 * A right password ends every run it is part of: the address's, the email's,
 * each browser's and the hundred.
 *
 * Every email tried writes the same rows and runs the same queries, whether or
 * not anyone signs in with it, so neither the answer nor the time it takes says
 * which do. A try is recorded before its password is checked, under a lock on
 * its address and on its email, so tries sent at once are each counted; one the
 * server fails to finish keeps no outcome, and counts as a wrong one. A request
 * a limit turns away is not a try, since no password is checked, and writes
 * nothing: a row for each would let anyone fill the disk for nothing.
 *
 * Rows are kept 90 days.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;
/** Wrong tries in a row an email is allowed before any wait. */
const FREE_IN_A_ROW = 10;
const FIRST_WAIT_S = 30;
const LONGEST_WAIT_S = 60 * 60;
export const STOPS_AT = 100;
const KEPT = sql`interval '90 days'`;

/** The seconds a try waits after `inARow` tries in a row at one email. */
export function waitAfter(inARow: number): number {
	return inARow < FREE_IN_A_ROW
		? 0
		: Math.min(FIRST_WAIT_S * 2 ** (inARow - FREE_IN_A_ROW), LONGEST_WAIT_S);
}

/** Which limit turned a request away, and the seconds until it will take a try. */
export type Refused = { by: 'address' | 'email'; wait: number };

const seconds = (until: number, now: Date) => Math.ceil((until - now.getTime()) / 1000);

/**
 * Whether a limit turns a try away: `recent` is the address's tries in the last
 * fifteen minutes since its last right one, newest first; `run`, the tries in a
 * row at the email from this browser, or from strangers.
 */
export function refusal(
	now: Date,
	recent: Date[],
	run: { inARow: number; last: Date | null }
): Refused | null {
	if (recent.length >= MAX_TRIES)
		return { by: 'address', wait: seconds(recent[MAX_TRIES - 1].getTime() + WINDOW_MS, now) };
	const next = run.last ? run.last.getTime() + waitAfter(run.inARow) * 1000 : 0;
	if (next > now.getTime()) return { by: 'email', wait: seconds(next, now) };
	return null;
}

/**
 * The address as Postgres keeps it, and the network the per-address limit
 * counts it in. An IPv4 address carried in IPv6 is the IPv4 address, and a zone
 * index, which only a link-local address has, is no part of where it came from.
 */
export function placeOf(address: string): { address: string; network: string } {
	const bare = address.replace(/%.*$/, '');
	const network = normalizeIP(bare);
	return network.includes(':')
		? { address: bare, network: `${network}/64` }
		: { address: network, network: `${network}/32` };
}

/** Its own key, drawn from the session secret. */
let key: Buffer | undefined;
/** What the record keeps of an email as typed: an HMAC, never the text. */
export function emailKey(email: string): string {
	key ??= createHmac('sha256', authSecret() ?? '')
		.update('reckon: emails tried')
		.digest();
	return createHmac('sha256', key).update(email).digest('base64url');
}

/** When the newest right try that `by` names was taken, or the beginning of time. */
const lastRight = (by: SQL) =>
	sql`coalesce((select max(${signInTry.createdAt}) from ${signInTry} where ${by} and ${signInTry.outcome} = 'right'), '-infinity'::timestamptz)`;

/**
 * A person's wrong tries in a row: since their last right one or since their
 * password was set, whichever is later. Null names nobody, and counts none.
 */
const wrongInARow = (userId: string | null, setAt: Date | null | SQL) =>
	sql<number>`(select count(*)::int from ${signInTry} where ${signInTry.userId} = ${userId}::uuid and ${signInTry.outcome} is distinct from 'right' and ${signInTry.createdAt} > greatest(${lastRight(sql`${signInTry.userId} = ${userId}::uuid`)}, coalesce(${setAt}, '-infinity'::timestamptz)))`;

/** A person's password stops, until a new one is set. Null names nobody. */
const stopFor = (tx: Tx, userId: string | null, unless: SQL = sql`true`) =>
	tx
		.update(user)
		.set({ passwordStoppedAt: sql`now()`, updatedAt: sql`${user.updatedAt}` })
		.where(and(sql`${user.id} = ${userId}::uuid`, isNull(user.passwordStoppedAt), unless));

/** A try recorded, before its password is checked. */
export type Try = { id: string; userId: string | null; stopped: boolean };

/**
 * Records a try at `email`'s password from `address`, before it is checked, or
 * turns it away and records nothing. `browser` is the browser's own count when
 * it has signed in as them. A try at a password that has stopped is recorded as
 * one, and is not to be checked.
 */
export async function takeTry(t: {
	page: (typeof TRY_PAGES)[number];
	address: string;
	email: string;
	browser: string | null;
}): Promise<{ refused: Refused } | Try> {
	// Each try deletes what has aged out, which is nearly always nothing.
	await db.delete(signInTry).where(lt(signInTry.createdAt, sql`now() - ${KEPT}`));
	const { address, network } = placeOf(t.address);
	const email = emailKey(t.email);
	const fromHere = sql`${signInTry.network} = ${network}::cidr`;
	return db.transaction(async (tx) => {
		// Address first, then email, in every transaction, so two never wait on
		// each other.
		await tx.execute(sql`select pg_advisory_xact_lock(1, hashtext(${network}))`);
		await tx.execute(sql`select pg_advisory_xact_lock(2, hashtext(${email}))`);
		// The moment the locks were had, which this try is stamped with. Not now(),
		// which is when the transaction began: one that waited on the locks would
		// be stamped before the tries it waited for, and read theirs as later
		// than its own. In milliseconds too, since a raw query's timestamp comes
		// back as text.
		const [{ at, ms }] = (
			await tx.execute<{ at: string; ms: number }>(
				sql`select c::text as at, (extract(epoch from c) * 1000)::float8 as ms from clock_timestamp() as c`
			)
		).rows;
		const stamp = sql`${at}::timestamptz`;
		const now = new Date(ms);

		const recent = await tx
			.select({ at: signInTry.createdAt })
			.from(signInTry)
			.where(
				and(
					fromHere,
					gt(signInTry.createdAt, sql`${stamp} - interval '15 minutes'`),
					gt(signInTry.createdAt, lastRight(fromHere))
				)
			)
			.orderBy(desc(signInTry.createdAt))
			.limit(MAX_TRIES);
		const [run] = await tx
			.select({ inARow: count(), last: max(signInTry.createdAt) })
			.from(signInTry)
			.where(
				and(
					eq(signInTry.emailKey, email),
					t.browser ? eq(signInTry.browser, t.browser) : isNull(signInTry.browser),
					gt(signInTry.createdAt, lastRight(eq(signInTry.emailKey, email)))
				)
			);
		const refused = refusal(
			now,
			recent.map((r) => r.at),
			run
		);
		if (refused) return { refused };

		const [person] = await tx
			.select({ id: user.id, setAt: user.passwordSetAt, stoppedAt: user.passwordStoppedAt })
			.from(user)
			.where(eq(user.email, t.email));
		const userId = person?.id ?? null;
		// Counted, and the stop saved, for an email nobody signs in with too,
		// naming nobody, so it takes as long.
		const [{ wrong }] = (
			await tx.execute<{ wrong: number }>(
				sql`select ${wrongInARow(userId, person?.setAt ?? null)} as wrong`
			)
		).rows;
		const stopped = !!person?.stoppedAt || wrong >= STOPS_AT;
		await stopFor(tx, stopped ? userId : null);

		const [made] = await tx
			.insert(signInTry)
			.values({
				createdAt: stamp,
				page: t.page,
				address,
				network,
				emailKey: email,
				userId,
				browser: t.browser,
				outcome: stopped ? 'stopped' : null
			})
			.returning({ id: signInTry.id });
		return { id: made.id, userId, stopped };
	});
}

/**
 * How a try came out, once its password was checked. A wrong one that is the
 * hundredth in a row stops the password there and then, so the stop does not
 * wait on a try that might never come.
 */
export async function settleTry(tried: Try, outcome: (typeof TRY_OUTCOMES)[number]): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.update(signInTry).set({ outcome }).where(eq(signInTry.id, tried.id));
		if (outcome === 'right') return;
		await stopFor(
			tx,
			tried.userId,
			sql`${wrongInARow(tried.userId, sql`${user.passwordSetAt}`)} >= ${STOPS_AT}`
		);
	});
}

/**
 * What a person's row is given when their password is set -- chosen, changed or
 * handed over: none of the old one's tries count against it, and it works.
 */
export const passwordSet = () => ({
	passwordSetAt: sql`now()`,
	passwordStoppedAt: null
});
