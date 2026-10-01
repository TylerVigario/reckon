import { json } from '@sveltejs/kit';
import { PROBLEM, type ProblemBody, type ProblemKind } from '$lib/problem';

/**
 * A problem document as an HTTP response. The shape it builds, and the kinds
 * it may be, are in $lib/problem so the screens that read one share them.
 */

export function problem(
	kind: ProblemKind,
	status: number,
	detail?: string,
	extra?: { errors?: Record<string, string>; instance?: string; headers?: HeadersInit }
) {
	const body: ProblemBody = {
		...PROBLEM[kind],
		status,
		...(detail ? { detail } : {}),
		...(extra?.instance ? { instance: extra.instance } : {}),
		...(extra?.errors ? { errors: extra.errors } : {})
	};
	return json(body, {
		status,
		headers: {
			// Not application/json: the media type is how a client knows this
			// describes a problem rather than being the thing it asked for.
			'content-type': 'application/problem+json',
			...(extra?.headers ?? {})
		}
	});
}
