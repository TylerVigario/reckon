import type { RequestEvent } from '@sveltejs/kit';
import { sql, type SqlBool } from 'kysely';
import { problem } from './problem.ts';

/**
 * Stops one person's save from silently erasing another's.
 *
 * Several people, one detail saved at a time, and a PATCH that is
 * last-write-wins: two people open a client, both save a detail, and the
 * earlier is gone with nothing on screen to say so. Saving a detail at a time
 * makes that MORE likely than one form for the lot, not less -- there is no
 * moment where either is told the screen is stale.
 *
 * This is HTTP conditional requests, RFC 9110: the page says which version it
 * read, and the write is refused if the row has moved since.
 *
 *   PATCH ...            If-Match: "885014"
 *   200 OK               ETag: "885303"       and the page holds the new one
 *   412 Precondition Failed                   somebody else got there first
 *
 * THE VERSION IS xmin, Postgres' own. Every row already has it and it changes
 * on every update, so there is no column to add, no trigger to write and
 * nothing that can be forgotten on an INSERT. It is a transaction id, which
 * wraps after four billion -- a stale tag matching again needs that many
 * transactions between one page load and one save.
 *
 * A REQUEST WITHOUT If-Match IS ALLOWED THROUGH. Not every caller is a page
 * with a version to hand -- the capture queue posts entries written offline,
 * and scripts exist. What this protects is the case it can see.
 */
export type Precondition = { ok: true; version: string | null } | { ok: false; response: Response };

export function preconditionOf(event: RequestEvent): Precondition {
	const header = event.request.headers.get('if-match');
	if (!header) return { ok: true, version: null };

	// A weak validator cannot be used for If-Match (RFC 9110 §13.1.1), and
	// this app never issues one, so it is a malformed request rather than a
	// mismatch.
	if (header.startsWith('W/')) {
		return {
			ok: false,
			response: problem('malformed', 'If-Match needs a strong validator.')
		};
	}
	if (header.trim() === '*') return { ok: true, version: null };

	const version = header.trim().replace(/^"|"$/g, '');
	if (!/^\d+$/.test(version)) {
		return {
			ok: false,
			response: problem('malformed', 'If-Match is not a version this issued.')
		};
	}
	return { ok: true, version };
}

/**
 * What the caller is told when the row moved under them. A screen fetches the
 * row again on being told (#lib/Detail), so saving again puts theirs over it.
 */
export const staleRead = (what: string, instance?: string) =>
	problem(
		'savedSinceRead',
		`Somebody saved ${what} since this screen read it. Save puts yours over theirs; Cancel keeps theirs.`,
		{ instance }
	);

/** The version to hand back, so the page can save again without reloading. */
export const withVersion = (response: Response, version: string | null) => {
	if (version) response.headers.set('ETag', `"${version}"`);
	return response;
};

/** A row's version as the page is given it: `.returning(VERSION.as('version'))`. */
export const VERSION = sql<string>`xmin::text`;

/**
 * The version of one table's row in a query that joins others, which have an
 * xmin of their own: `versionOf('s')`, by the table's name or alias. xmin is a
 * system column, which the generated types do not list, so the name is not
 * checked against them.
 */
export const versionOf = (table: string) => sql<string>`${sql.ref(`${table}.xmin`)}::text`;

/**
 * The update's guard: the row is still the version the page read. Nothing to
 * guard when the request named no version, and the condition says so: true.
 */
export const unchangedSince = (version: string | null) =>
	version === null ? sql<SqlBool>`true` : sql<SqlBool>`xmin::text = ${version}`;
