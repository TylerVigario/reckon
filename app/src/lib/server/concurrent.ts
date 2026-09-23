import type { RequestEvent } from '@sveltejs/kit';
import { problem } from './problem';

/**
 * Stops one person's save from silently erasing another's.
 *
 * Two partners, per-field autosave, and every PATCH was last-write-wins: you
 * both open a client, you both blur a field, and the earlier edit is gone with
 * nothing on screen to say so. Per-field saving makes that MORE likely than a
 * form with a save button, not less -- there is no moment where either of you
 * is told the page is stale.
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
			response: problem('malformed', 400, 'If-Match needs a strong validator.')
		};
	}
	if (header.trim() === '*') return { ok: true, version: null };

	const version = header.trim().replace(/^"|"$/g, '');
	if (!/^\d+$/.test(version)) {
		return {
			ok: false,
			response: problem('malformed', 400, 'If-Match is not a version this issued.')
		};
	}
	return { ok: true, version };
}

/** What the caller is told when the row moved under them. */
export const staleRead = (what: string, instance?: string) =>
	problem(
		'conflict',
		412,
		`${what} changed since this page read it. Reload to see the current values before saving again.`,
		{ instance }
	);

/** The version to hand back, so the page can save again without reloading. */
export const withVersion = (response: Response, version: string | null) => {
	if (version) response.headers.set('ETag', `"${version}"`);
	return response;
};
