// The security log as people read it (#lib/SecurityLog): newest first, a page
// at a time, each event in words, with whom it was about, who did it where that
// was someone else, and where it came from. What is kept, and why, is
// security_event's own comment; what is recorded, #lib/server/events.
import type { Expression, SqlBool } from 'kysely';
import { browserName } from '#lib/browser-name.ts';
import { UUID } from '#lib/field-rules.ts';
import { db } from './db/index.ts';
import { SAYS, type SecurityEvent } from './events.ts';

/** Events on a page. */
export const PAGE = 50;

/** One event, as a person reads it. */
export type LoggedEvent = {
	id: string;
	at: string;
	name: SecurityEvent;
	says: string;
	/** What else it says, in words: a reason, from and to, which passkey. */
	detail: string;
	/** Whom it was about, by name, and their id. */
	about: { id: string; name: string } | null;
	/** Who did it, where it was someone else. */
	by: string | null;
	/** Where from: the address, and the browser and system its user agent names. */
	address: string | null;
	from: string | null;
};

type Detail = Record<string, string | number | boolean | null> | null;

const PURPOSE: Record<string, string> = {
	invite: 'an invitation',
	reset: 'a new link to make a passkey',
	confirm: 'to confirm an address',
	change: 'to change the address they sign in with'
};

const REFUSED: Record<string, string> = {
	'unknown passkey': 'a passkey reckon doesn’t know',
	'check failed': 'the passkey’s check failed',
	'not verified': 'the passkey didn’t check who was holding it',
	'not active': 'they are no longer active',
	expired: 'the sign-in ran out of time'
};

const CHANGED: Record<string, string> = {
	name: 'their name',
	email: 'the address they sign in with',
	role_id: 'the role they are paid as'
};

const ACCESS: Record<string, string> = { full: 'Full', field: 'Field' };

/**
 * A refusal's title on the page, beside the label that says it was refused:
 * the log's own words would say so twice.
 */
const TITLE: Partial<Record<SecurityEvent, string>> = {
	authn_login_fail: 'Sign-in',
	excess_rate_limit_exceeded: 'Tried too often',
	authn_link_refused: 'A link that no longer works',
	authz_fail: 'Lack of access'
};

/** What `name`'s detail says, in words. Unknown keys say nothing. */
export function inWords(name: SecurityEvent, d: Detail): string {
	if (!d) return '';
	const s = (k: string) => (typeof d[k] === 'string' ? d[k] : null);
	const n = (k: string) => (typeof d[k] === 'number' ? d[k] : null);
	const parts: string[] = [];
	switch (name) {
		case 'authn_login_success':
			if (s('with')) parts.push(`with ${s('with')}`);
			break;
		case 'authn_login_fail':
			if (s('because') && REFUSED[s('because')!]) parts.push(REFUSED[s('because')!]);
			break;
		case 'excess_rate_limit_exceeded':
			if (s('tried')) parts.push(s('tried')!);
			break;
		case 'session_expired': {
			const many = n('sessions');
			if (many) parts.push(`${many} ${many === 1 ? 'session' : 'sessions'}`);
			if (s('why')) parts.push(s('why')!);
			break;
		}
		case 'authn_passkey_added':
			if (s('passkey')) parts.push(s('passkey')!);
			if (s('with')) parts.push(`made with ${s('with')}`);
			break;
		case 'authn_passkey_removed': {
			const many = n('passkeys');
			if (s('passkey')) parts.push(s('passkey')!);
			else if (many) parts.push(`all ${many === 1 ? 'one' : many} of their passkeys`);
			if (s('why') === 'ended') parts.push('ended, as lost or stolen');
			break;
		}
		case 'authn_link_issued':
		case 'authn_link_used':
			if (s('purpose') && PURPOSE[s('purpose')!]) parts.push(PURPOSE[s('purpose')!]);
			break;
		case 'user_created':
			if (s('access') && ACCESS[s('access')!]) parts.push(`with ${ACCESS[s('access')!]} access`);
			break;
		case 'user_updated':
			if (s('changed') && CHANGED[s('changed')!]) parts.push(CHANGED[s('changed')!]);
			if (s('with')) parts.push(`with ${s('with')}`);
			break;
		case 'authz_change':
			if (s('from') && s('to'))
				parts.push(`${ACCESS[s('from')!] ?? s('from')} to ${ACCESS[s('to')!] ?? s('to')}`);
			break;
		case 'user_archived':
			if (s('why')) parts.push(`“${s('why')}”`);
			break;
		case 'authz_fail':
			if (s('route')) parts.push(`${s('method') ?? ''} ${s('route')}`.trim());
			break;
	}
	if (s('via') === 'scripts/user.mjs') parts.push('from the command line on the host');
	return parts.join(' · ');
}

/**
 * A page of the security log: everyone's, or what involves one person -- what
 * happened to them, and what they did to anyone else, as GitHub's own lists
 * "actions you've performed and actions others have performed that involve
 * you". `before` is the last event on the page before, as `older` gave it.
 */
export async function securityLog(whose: { person: string } | 'everyone', before?: string | null) {
	const cursor = before ? parseCursor(before) : null;
	const rows = await db
		.selectFrom('security_event as e')
		.leftJoin('user as them', 'them.id', 'e.user_id')
		.leftJoin('user as whom', 'whom.id', 'e.by_id')
		.select([
			'e.id',
			'e.at',
			'e.name',
			'e.detail',
			'e.user_id',
			'them.name as about_name',
			'whom.name as by_name',
			'e.client_address',
			'e.user_agent'
		])
		.where((eb) => {
			const which: Expression<SqlBool>[] = [];
			if (whose !== 'everyone')
				which.push(eb.or([eb('e.user_id', '=', whose.person), eb('e.by_id', '=', whose.person)]));
			if (cursor)
				which.push(
					eb(
						eb.refTuple('e.at', 'e.id'),
						'<',
						eb.tuple(
							eb.cast<Date>(eb.val(cursor.at), 'timestamptz'),
							eb.cast<string>(eb.val(cursor.id), 'uuid')
						)
					)
				);
			return eb.and(which);
		})
		.orderBy('e.at', 'desc')
		.orderBy('e.id', 'desc')
		.limit(PAGE + 1)
		.execute();
	const events: LoggedEvent[] = rows.slice(0, PAGE).map((r) => ({
		id: r.id,
		at: r.at.toISOString(),
		name: r.name,
		says: TITLE[r.name] ?? SAYS[r.name],
		detail: inWords(r.name, r.detail as Detail),
		about: r.user_id ? { id: r.user_id, name: r.about_name ?? 'Someone' } : null,
		by: r.by_name,
		address: r.client_address,
		from: browserName(r.user_agent)
	}));
	const last = events.at(-1);
	return { events, older: rows.length > PAGE && last ? `${last.at}_${last.id}` : null };
}

const CURSOR = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)_(.+)$/;

/**
 * A cursor this page gave, or null for anything else: it starts again from the
 * newest. A moment that never was, or an id that is not one, is anything else.
 */
function parseCursor(before: string) {
	const m = CURSOR.exec(before);
	if (!m || !UUID.test(m[2])) return null;
	try {
		Temporal.Instant.from(m[1]);
	} catch {
		return null;
	}
	return { at: m[1], id: m[2] };
}
