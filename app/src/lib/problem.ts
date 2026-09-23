/**
 * API errors in the shape RFC 9457 defines.
 *
 * THE SHAPE, NOT THE RESPONSE. This half is shared: the server builds problem
 * documents and every screen reads them, and two definitions of one wire format
 * is how a field rename becomes a screen that silently shows nothing. The
 * `problem()` that turns this into a Response lives in $lib/server/problem,
 * because a client importing anything under $lib/server is a build error.
 *
 * Before this the API had two shapes it invented -- { message } in thirteen
 * places and { errors } in one -- and neither said what kind of problem it
 * was, only what happened to be convenient at the time. RFC 9457 gives a
 * carrier every HTTP client already understands, and, usefully here, an
 * explicit place for extension members: the per-field map this app has always
 * returned is one, rather than a private convention a reader has to learn.
 *
 *   type      what kind of problem. Stable, and the thing to branch on.
 *   title     the same words every time for that type, so it can be looked up.
 *   status    repeated in the body because the body gets logged without it.
 *   detail    what went wrong THIS time. Safe to show a person.
 *   instance  which request it was.
 *   errors    extension: message per field, for a form to show in place.
 *
 * The media type matters as much as the shape: application/problem+json is
 * what tells a client this is an error document and not the thing it asked
 * for.
 */

/** The kinds of problem this API has. A type is only worth having if it is stable. */
export const PROBLEM = {
	invalidField: {
		type: '/problems/invalid-field',
		title: 'A value was refused'
	},
	malformed: {
		type: '/problems/malformed-request',
		title: 'The request was not the shape this expects'
	},
	notFound: {
		type: '/problems/not-found',
		title: 'No such thing'
	},
	conflict: {
		type: '/problems/conflict',
		title: 'Somebody else changed this first'
	},
	upstream: {
		type: '/problems/upstream-refused',
		title: 'Something this depends on could not answer'
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
