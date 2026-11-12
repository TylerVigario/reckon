// The security log: each thing that happens to how someone signs in and what
// they can reach, kept in security_event for people to read (Your profile, and
// Team for someone with Full) and written as a line of the server's log
// (#lib/server/log). The table's own comment says what it holds and why it
// stands.
//
// Plain TypeScript over Drizzle, with nothing of SvelteKit's, so the commands in
// scripts/ record as the server does. Where a request is in hand, the server
// says how to read it (readOriginFrom, in hooks.server.ts).
import { lt, sql } from 'drizzle-orm';
import { db, type Db, type Tx } from './db/index.ts';
import { securityEvent, type SECURITY_EVENTS } from './db/schema/index.ts';
import { log } from './log.ts';

export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

/**
 * Each event's level in the log, as OWASP's Logging Vocabulary sets it, its
 * CRITICAL being pino's error. Where it names none, its nearest: a passkey as
 * its authn_token_created and authn_token_revoked, a link the same, a link that
 * no longer works as a failed sign-in, an access review as authz_admin -- "all
 * activity by privileged users".
 */
const LEVEL: Record<SecurityEvent, 'info' | 'warn' | 'error'> = {
	authn_login_success: 'info',
	authn_login_fail: 'warn',
	excess_rate_limit_exceeded: 'warn',
	session_logout: 'info',
	session_expired: 'info',
	authn_passkey_added: 'info',
	authn_passkey_removed: 'info',
	authn_link_issued: 'info',
	authn_link_used: 'info',
	authn_link_refused: 'warn',
	user_created: 'warn',
	user_updated: 'warn',
	authz_change: 'warn',
	user_archived: 'warn',
	user_restored: 'warn',
	authz_fail: 'error',
	access_reviewed: 'warn'
};

/** What each says, for a person to read: the Security log's words, and the log line's. */
export const SAYS: Record<SecurityEvent, string> = {
	authn_login_success: 'Signed in',
	authn_login_fail: 'A sign-in was refused',
	excess_rate_limit_exceeded: 'Turned away for trying too often',
	session_logout: 'Signed out',
	session_expired: 'Signed out everywhere',
	authn_passkey_added: 'A passkey was added',
	authn_passkey_removed: 'A passkey was removed',
	authn_link_issued: 'A link was sent',
	authn_link_used: 'A link was used',
	authn_link_refused: 'A link that no longer works was opened',
	user_created: 'Added to reckon',
	user_updated: 'Details changed',
	authz_change: 'Access changed',
	user_archived: 'Made inactive',
	user_restored: 'Made active again',
	authz_fail: 'Refused, for lack of access',
	access_reviewed: 'Access reviewed'
};

/** Where a request came from, and who was signed in to make it. */
export type Origin = { address?: string; userAgent?: string; by?: string | null };

let originNow: () => Origin = () => ({});

/**
 * How to read the request in hand, given once by the server: a command on the
 * host has none, and records where it came from in its detail instead.
 */
export function readOriginFrom(read: () => Origin) {
	originNow = read;
}

/**
 * Records `name`: a row of the security log, in `to` -- the transaction the
 * change it records is made in, so neither is kept without the other -- and a
 * line of the server's log. `user` is whom it is about; `by`, who did it, is
 * the person signed in to the request in hand unless said, and is kept only
 * where it is someone else. `detail` is what else it says, never a secret.
 */
export async function record(
	to: Db | Tx,
	name: SecurityEvent,
	about: {
		user?: string | null;
		by?: string | null;
		detail?: Record<string, string | number | boolean | null>;
	} = {}
): Promise<void> {
	const from = originNow();
	const user = about.user ?? null;
	const by = about.by === undefined ? (from.by ?? null) : about.by;
	const row = {
		name,
		userId: user,
		byId: by && by !== user ? by : null,
		clientAddress: from.address ?? null,
		userAgent: from.userAgent?.slice(0, 512) ?? null,
		detail: about.detail ?? null
	};
	log[LEVEL[name]](
		{
			event: name,
			'user.id': row.userId ?? undefined,
			'by.user.id': row.byId ?? undefined,
			'client.address': row.clientAddress ?? undefined,
			'user_agent.original': row.userAgent ?? undefined,
			...(row.detail ? { detail: row.detail } : {})
		},
		SAYS[name]
	);
	await to.insert(securityEvent).values(row);
}

/**
 * Records `name` outside any change of its own -- a sign-in, a refusal -- where
 * failing to keep the row must not turn the request away: the line in the log
 * is written first, and the row's failure is a line of its own.
 */
export async function recordAside(name: SecurityEvent, about?: Parameters<typeof record>[2]) {
	try {
		await record(db, name, about);
	} catch (e) {
		log.error({ event: name, err: e }, 'A security event was not kept');
	}
}

/**
 * Removes every security event a year old, as the table allows and nothing
 * else (PCI DSS 10.5.1's twelve months). How many went.
 */
export async function prune(): Promise<number> {
	const gone = await db
		.delete(securityEvent)
		.where(lt(securityEvent.at, sql`now() - interval '1 year'`))
		.returning({ id: securityEvent.id });
	if (gone.length) log.info({ removed: gone.length }, 'Security events a year old removed');
	return gone.length;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Prunes as the server starts and every day after, until it stops: the timer
 * keeps nothing running, so adapter-node's shutdown waits for nothing of it.
 */
export function startPruning() {
	const run = () =>
		prune().catch((e: unknown) => log.error({ err: e }, 'Pruning the security log failed'));
	void run();
	const timer = setInterval(() => void run(), DAY);
	timer.unref();
	process.once('sveltekit:shutdown', () => clearInterval(timer));
}
