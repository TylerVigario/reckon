import { PROBLEM, type ProblemBody, type ProblemKind } from '#lib/problem.ts';

/**
 * A problem document as an HTTP response. The shape it builds, and the kinds
 * it may be, are in #lib/problem so the screens that read one share them.
 */

export function problem(
	kind: ProblemKind,
	status: number,
	detail?: string,
	extra?: {
		errors?: Record<string, string>;
		instance?: string;
		headers?: HeadersInit;
		/** Extension members beyond errors, as RFC 9457 allows: a collision, say. */
		members?: Record<string, unknown>;
	}
) {
	const body: ProblemBody & Record<string, unknown> = {
		...(extra?.members ?? {}),
		...PROBLEM[kind],
		status,
		...(detail ? { detail } : {}),
		...(extra?.instance ? { instance: extra.instance } : {}),
		...(extra?.errors ? { errors: extra.errors } : {})
	};
	return Response.json(body, {
		status,
		headers: {
			// Not application/json: the media type is how a client knows this
			// describes a problem rather than being the thing it asked for.
			'content-type': 'application/problem+json',
			...(extra?.headers ?? {})
		}
	});
}
