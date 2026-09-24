/**
 * The pieces every field rule is built from.
 *
 * Split out of settings-fields once a second registry needed them: the
 * operator's settings and a service's terms are different vocabularies, but
 * "a whole number, at least 1" and "NUMERIC(8,2)" mean the same thing in both,
 * and a second copy of `decimal` would be a second copy to get wrong.
 *
 * Everything here is shared by the browser and the server. Nothing in it may
 * import from $lib/server.
 */

export type Parsed =
	{ ok: true; value: string | number | boolean | null } | { ok: false; why: string };

export const ok = (value: string | number | boolean | null): Parsed => ({ ok: true, value });
export const no = (why: string): Parsed => ({ ok: false, why });

export type Parse = (raw: string) => Parsed;

/** A registry is a vocabulary: its keys are the fields, and nothing else is. */
export type Registry = Record<string, Parse>;

/**
 * Zero-width and soft-hyphen characters, which arrive by being pasted out of a
 * word processor or a web page and are invisible in every field that holds
 * them. Written as escapes, because a literal one in this file would be as
 * invisible here as it is in a trading name.
 *
 * Stripped rather than refused: nobody typed one on purpose, and "there is an
 * invisible character in your trading name" is not an error anyone can act on.
 */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

/** Control characters, including the NUL that Postgres refuses outright. */
// eslint-disable-next-line no-control-regex -- the control characters ARE the subject
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Nothing behind these registries is a document. Anything longer is not a mistake. */
const ABSURD = 1000;

export const text = (v: string): Parsed => ok(v);

/** Empty means "not set", which the column allows. */
export const optional =
	(fn: Parse): Parse =>
	(raw) => {
		const v = raw.trim();
		return v === '' ? ok(null) : fn(v);
	};

/** Empty means the column's own default, because the column is NOT NULL. */
export const orDefault =
	(fallback: string, fn: Parse = text): Parse =>
	(raw) => {
		const v = raw.trim();
		return v === '' ? ok(fallback) : fn(v);
	};

export const required =
	(why: string, fn: Parse = text): Parse =>
	(raw) => {
		const v = raw.trim();
		return v === '' ? no(why) : fn(v);
	};

/** A length nobody would reach by typing what the field is for. */
export const cap =
	(n: number, fn: Parse = text): Parse =>
	(v) =>
		v.length > n ? no(`At most ${n} characters.`) : fn(v);

export const oneOf =
	(allowed: readonly string[]): Parse =>
	(v) =>
		allowed.includes(v) ? ok(v) : no(`Must be one of: ${allowed.join(', ')}.`);

/**
 * Whole numbers only: "12abc" is a typo, not twelve. The upper bound is the
 * column's, not a policy -- these are Postgres `integer`s, and a value above it
 * is an overflow rather than a large number.
 */
const INT4_MAX = 2147483647;
export const whole =
	(least: number): Parse =>
	(v) => {
		if (!/^\d+$/.test(v)) return no('Must be a whole number.');
		const n = Number.parseInt(v, 10);
		if (n > INT4_MAX) return no('That number is too large.');
		return n < least ? no(`Must be ${least} or more.`) : ok(n);
	};

/**
 * NUMERIC(precision, scale), stated the way the column states it.
 *
 * The value is kept as a string all the way to Postgres. Money and rates are
 * NUMERIC, and parsing one into a JS number is how cents go missing -- the same
 * rule db.ts enforces coming the other way.
 */
export const decimal =
	(precision: number, scale: number): Parse =>
	(v) => {
		const room = precision - scale;
		if (new RegExp(`^\\d{1,${room}}(\\.\\d{1,${scale}})?$`).test(v)) return ok(v);
		if (!/^\d+(\.\d+)?$/.test(v)) return no('Must be a number, and not negative.');
		const [, after = ''] = v.split('.');
		if (after.length > scale) return no(`At most ${scale} decimal place${scale === 1 ? '' : 's'}.`);
		return no(`At most ${room} digit${room === 1 ? '' : 's'} before the decimal point.`);
	};

/**
 * A phone number, kept exactly as it was typed.
 *
 * This one prints at the top of an invoice. 559-900-1400 and 5599001400 are
 * both in use here already, and normalising either to +15599001400 would be
 * this file deciding how the business looks in print.
 *
 * So what is checked is shape, not nationality. Guessing the country from the
 * time zone is the kind of inference that works until somebody bills across a
 * border, and there is no country on the operator to ask. E.164 caps a number
 * at 15 digits including the country code; below about seven there is nothing
 * long enough to dial. Between those, anything a person can write down is
 * allowed through -- spaces, brackets, dashes and dots all mean the same
 * number, and refusing one of them teaches nobody anything.
 *
 * An extension is part of what a person would read out, so it is kept rather
 * than refused: "559-900-1400 x12".
 */
export function phone(v: string): Parsed {
	const parts = v.split(/\s*(?:ext\.?|x|#)\s*/i);
	if (parts.length > 2) return no('One extension, not two.');
	const [dial, ext] = parts;

	if (!/^\+?[\d\s().-]+$/.test(dial)) return no('Digits, and + ( ) - . or spaces. Nothing else.');

	const digits = dial.replace(/\D/g, '');
	if (digits.length < 7) return no('Too short to be a phone number.');
	if (digits.length > 15) return no('Too long \u2014 15 digits is the international maximum.');

	if (ext !== undefined && !/^\d{1,6}$/.test(ext)) return no('An extension is up to six digits.');
	return ok(v.trim());
}

/**
 * A switch. The page sends the word, not a checkbox's absence: an unchecked box
 * sends nothing at all, and "nothing" is indistinguishable from "the field was
 * not on the form" -- which is how a flag silently clears itself.
 *
 * IT RETURNS A REAL BOOLEAN, and that is not a tidiness point. Handing
 * postgres.js the STRING 'true' for a boolean column stores FALSE -- no error,
 * no warning, the update reports success and the wrong value is in the row.
 * Verified against this driver:
 *
 *     update operator set auto_send = 'true'  (as a text parameter) -> false
 *     update operator set auto_send = true    (as a boolean)        -> true
 *
 * Every other rule here returns a string on purpose, because NUMERIC must not
 * pass through a JS number. A boolean is the exception, and this is why.
 */
export const flag: Parse = (v) => {
	const t = v.trim().toLowerCase();
	if (t === 'true' || t === 'yes' || t === 'on') return ok(true);
	if (t === 'false' || t === 'no' || t === 'off') return ok(false);
	return no('Must be true or false.');
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A row's id, as the page was given it. Anything else is not a reference. */
export const anId: Parse = (v) =>
	UUID.test(v) ? ok(v.toLowerCase()) : no('That is not one of ours.');

/**
 * A calendar day, as a date input sends it: YYYY-MM-DD, and a day that exists.
 * 2026-02-30 is refused here rather than rolled into March by whatever parses
 * it next.
 */
export const isoDate: Parse = (v) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
	if (!m) return no('A date, as YYYY-MM-DD.');
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const day = new Date(Date.UTC(y, mo - 1, d));
	if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d)
		return no('There is no such day.');
	return ok(v);
};

/**
 * Parse one field of one registry. An unknown name is refused, never guessed at.
 *
 * Cleaning happens here rather than inside each rule, so there is one place
 * that decides what a value may be made of, and no field can be added to any
 * registry that forgets to ask.
 */
export function parseIn(registry: Registry, name: string, raw: string): Parsed {
	const parse = registry[name];
	if (!parse) return no(`There is no setting called ${name}.`);
	if (raw.length > ABSURD) return no('That is far longer than this field is for.');
	if (CONTROL.test(raw)) return no('That contains a control character.');
	return parse(raw.replace(INVISIBLE, ''));
}

/**
 * Every field of a registry, from one submission. Fields not sent are parsed as
 * empty, so a required one answers "this is needed" rather than passing
 * unmentioned; anything that is not text or a number is refused by name.
 */
export function parseAll(
	registry: Registry,
	fields: Record<string, unknown>
): { values: Record<string, string | number | boolean | null>; errors: Record<string, string> } {
	const values: Record<string, string | number | boolean | null> = {};
	const errors: Record<string, string> = {};
	for (const name of Object.keys(registry)) {
		const raw = fields[name];
		if (raw !== null && raw !== undefined && typeof raw !== 'string' && typeof raw !== 'number') {
			errors[name] = 'Expected a value, not a structure.';
			continue;
		}
		const parsed = parseIn(registry, name, raw === null || raw === undefined ? '' : String(raw));
		if (parsed.ok) values[name] = parsed.value;
		else errors[name] = parsed.why;
	}
	return { values, errors };
}
