import type { ProblemLike } from '$lib/problem';

/**
 * Reading JSON off the wire without `any` getting in.
 *
 * `Request.json()` and `Response.json()` are both typed `Promise<any>`, and an
 * `any` does not stay where it lands: every field read off it is unchecked,
 * every value passed on from it is unchecked, and nothing in the file says so.
 * That is how a string `'true'` reached a boolean column and stored FALSE.
 *
 * `unknown` stops it at the door. The caller has to say what it expects, once,
 * and the shapes are declared beside the endpoint that answers them.
 */

/** A parsed body, as `unknown`. Rejects exactly as `.json()` does. */
export const readJson = (r: { json(): Promise<unknown> }): Promise<unknown> => r.json();

/**
 * An object body, or null when the request carried something else -- no body,
 * malformed JSON, a bare array, a number. Every endpoint that saves fields was
 * writing that check out by hand; the shape of a refusal is theirs, but the
 * question is the same one.
 */
export async function readBody(request: {
	json(): Promise<unknown>;
}): Promise<Record<string, unknown> | null> {
	const body = await readJson(request).catch(() => null);
	if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
	return body as Record<string, unknown>;
}

/**
 * The `{ fields: { name: value } }` envelope every save endpoint takes.
 *
 * Five endpoints were each writing this check out, which means five places to
 * change if the envelope ever does, and five chances for one of them to accept
 * something the others refuse. Null means it was not that envelope; the words
 * used to refuse it stay with the endpoint, because they name its fields.
 */
export async function readFields(request: {
	json(): Promise<unknown>;
}): Promise<Record<string, unknown> | null> {
	const body = await readBody(request);
	const fields = body?.fields;
	if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
	return fields as Record<string, unknown>;
}

/**
 * One field off a parsed body, when it is text and nothing else.
 *
 * `String(body?.x ?? '')` reads an object as "[object Object]" and an array as
 * its joined elements, so a field that arrives as the wrong kind of thing
 * becomes a plausible-looking string rather than a refusal.
 */
export function textField(body: Record<string, unknown> | null, name: string): string {
	const v = body?.[name];
	return typeof v === 'string' ? v : '';
}

/**
 * A refusal from this API, whatever the response turned out to be.
 *
 * Screens read `.errors`, `.detail` and `.title` off a failed save. A proxy or
 * a 502 page is not a problem document, so this narrows to one rather than
 * assuming, and an empty object reads the same as a document with no detail --
 * which is what the fallback message is for.
 */
export async function readProblem(r: { json(): Promise<unknown> }): Promise<ProblemLike> {
	const b = await readJson(r).catch(() => null);
	return b !== null && typeof b === 'object' && !Array.isArray(b) ? b : {};
}

/**
 * What a field-saving endpoint answers with when it takes the change.
 *
 * `saved` echoes the values as they were written, which is how a box shows the
 * canonical form of what somebody typed. They are scalars because that is what
 * the registry parses a field into -- the endpoints build exactly this.
 * `version` is the row's new version, for the next conditional save.
 */
export type Saved = {
	saved?: Record<string, string | number | boolean | null>;
	version?: string;
};
