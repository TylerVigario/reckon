/**
 * API errors in the shape RFC 9457 defines.
 *
 * THE SHAPE, NOT THE RESPONSE. This half is shared: the server builds problem
 * documents and every screen reads them, and two definitions of one wire format
 * is how a field rename becomes a screen that silently shows nothing. The
 * `problem()` that turns this into a Response lives in #lib/server/problem,
 * because a client importing anything under #lib/server is a build error.
 *
 * One shape for every refusal, saying what kind of problem it is. RFC 9457
 * gives a carrier every HTTP client already understands, and, usefully here,
 * an explicit place for extension members: the per-field map this app returns
 * is one, rather than a private convention a reader has to learn.
 *
 *   type      what kind of problem. Stable, and the thing to branch on.
 *   title     the same words every time for that type, so it can be looked up.
 *   status    the one status the type is sent with (RFC 9457 s. 4), repeated in
 *             the body because the body gets logged without it.
 *   detail    what went wrong THIS time. Safe to show a person.
 *   instance  which request it was.
 *   errors    extension: message per field, for a form to show in place.
 *
 * The media type matters as much as the shape: application/problem+json is
 * what tells a client this is an error document and not the thing it asked
 * for.
 */

/** What a problem document is sent as, and how a client tells one from what it asked for. */
export const PROBLEM_MEDIA_TYPE = 'application/problem+json';

/**
 * The kinds of problem this API has. A type is only worth having if it is
 * stable, and each is sent with its one status: a problem type's definition
 * documents "the HTTP status code for it to be used with" (RFC 9457 s. 4), so
 * #lib/server/problem takes it from here and no call can send another.
 *
 * A refusal a client can do something about says which of three it is, so a
 * save that lost a race -- which looking again puts right -- is never read as
 * one that looking again will not change:
 *
 *   changedMeanwhile  a save ran into a change made since it was read: a
 *                     field somebody else changed, work billed or paid
 *                     meanwhile. Look again, then save again.
 *   savedSinceRead    the version a save names is not the one there now
 *                     (If-Match, RFC 9110 s. 15.5.13). Read it again.
 *   notAsThingsStand  what it is now refuses it -- recorded work refers to it,
 *                     it has been applied, sent or put in force -- and looking
 *                     again will not change that. The detail says what to do
 *                     instead.
 */
export const PROBLEM = {
	invalidField: {
		type: '/problems/invalid-field',
		title: 'A value was refused',
		status: 400
	},
	malformed: {
		type: '/problems/malformed-request',
		title: 'The request was not the shape this expects',
		status: 400
	},
	notFound: {
		type: '/problems/not-found',
		title: 'No such thing',
		status: 404
	},
	changedMeanwhile: {
		type: '/problems/changed-meanwhile',
		title: 'Somebody else changed this first',
		status: 409
	},
	savedSinceRead: {
		type: '/problems/saved-since-read',
		title: 'Somebody saved this since it was read',
		status: 412
	},
	notAsThingsStand: {
		type: '/problems/not-as-things-stand',
		title: 'Not as things stand',
		status: 409
	},
	upstream: {
		type: '/problems/upstream-refused',
		title: 'Something this depends on could not answer',
		status: 502
	},
	notYours: {
		type: '/problems/not-yours',
		title: 'Only its owner can change this',
		status: 403
	},
	beyondAccess: {
		type: '/problems/beyond-access',
		title: "Beyond what this person's access reaches",
		status: 403
	},
	emailUnset: {
		type: '/problems/email-unset',
		title: 'This sends an email, and reckon cannot send one yet',
		status: 409
	}
} as const;

export type ProblemKind = keyof typeof PROBLEM;

export type ProblemBody = {
	type: string;
	title: string;
	status: number;
	detail?: string;
	instance?: string;
	errors?: Record<string, string>;
};

/** Whatever came back from this API when it refused. Fields are optional
 * because a response from anywhere else -- a proxy, a 502 page -- is not one
 * of these, and reading it should narrow rather than assume. */
export type ProblemLike = Partial<ProblemBody>;
