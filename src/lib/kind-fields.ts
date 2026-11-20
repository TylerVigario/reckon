/**
 * What a business says about a kind of sale (sale_kind), and about whether a
 * state it collects in taxes one (taxability). The pages and their endpoints
 * both import this: the page answers as a person types, and the endpoint
 * checks again.
 *
 * ONLY THESE KEYS CAN BE WRITTEN. A field named in a request is looked up here
 * and nowhere else, and the column written is this object's own key.
 */
import { cap, flag, parseIn, required, type Parsed } from './field-rules.ts';

export const KIND_FIELDS = {
	// What the business calls it: Repair labour, Help desk.
	name: required('What the business calls it.', cap(80)),
	// Whether it is offered for an item.
	active: flag
};

/** Parse one field of a kind by name. An unknown name is refused. */
export function parseKindField(name: string, raw: string): Parsed {
	return parseIn(KIND_FIELDS, name, raw);
}

export const ANSWER_FIELDS = { taxed: flag };

/** Parse a state's answer for a kind. */
export function parseAnswerField(name: string, raw: string): Parsed {
	return parseIn(ANSWER_FIELDS, name, raw);
}

/**
 * Answers, one for each of `keys` -- the states a kind is answered in, or the
 * kinds a state answers -- as `{ [key]: true | false }`, or the words a form
 * sends, "true" and "false". Each key missing, or answered with anything else,
 * is refused under `taxed.<key>`: none is assumed.
 */
export function parseAnswers(raw: unknown, keys: readonly string[], why: (key: string) => string) {
	const given = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	const answers: Record<string, boolean> = {};
	const errors: Record<string, string> = {};
	for (const key of keys) {
		const v = (given as Record<string, unknown>)[key];
		if (v === true || v === 'true') answers[key] = true;
		else if (v === false || v === 'false') answers[key] = false;
		else errors[`taxed.${key}`] = why(key);
	}
	return { answers, errors };
}
