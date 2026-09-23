import { describe, expect, it } from 'vitest';
import { readBody, readFields, readJson, textField } from './json';

/** A stand-in for Request/Response -- both are just something with .json(). */
const carrying = (body: unknown) => ({ json: () => Promise.resolve(body) });
const broken = { json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) };

describe('readBody', () => {
	it('gives back an object body', async () => {
		expect(await readBody(carrying({ a: 1 }))).toEqual({ a: 1 });
	});

	// Null for everything that is not an object, so one check at the top of an
	// endpoint covers all of them. A bare array is the one that looks like a
	// body and is not.
	it('gives null for anything that is not an object', async () => {
		for (const b of [null, 42, 'a string', true, [1, 2, 3], []])
			expect(await readBody(carrying(b))).toBeNull();
	});

	it('gives null rather than throwing on malformed JSON', async () => {
		expect(await readBody(broken)).toBeNull();
	});
});

describe('readFields', () => {
	it('unwraps the envelope every save endpoint takes', async () => {
		expect(await readFields(carrying({ fields: { terms_days: '30' } }))).toEqual({
			terms_days: '30'
		});
	});

	it('refuses a body with no fields, or fields that are not a map', async () => {
		for (const b of [{}, { fields: null }, { fields: [] }, { fields: 'terms_days' }, null])
			expect(await readFields(carrying(b))).toBeNull();
	});

	// An empty map is a shape question, not a count question: it IS the
	// envelope, and "no fields given" is the endpoint's own refusal with its
	// own words. Returning null here would answer the wrong one.
	it('passes an empty map through for the endpoint to refuse', async () => {
		expect(await readFields(carrying({ fields: {} }))).toEqual({});
	});
});

describe('textField', () => {
	it('reads a string field', () => {
		expect(textField({ name: 'Bravo Farms' }, 'name')).toBe('Bravo Farms');
	});

	// The reason this exists: String(body?.x ?? '') turns an object into
	// "[object Object]" and an array into its joined elements, so a field of
	// the wrong kind became a plausible-looking value instead of a refusal.
	it('gives empty for anything that is not a string', () => {
		for (const v of [{}, [], 42, true, null, undefined])
			expect(textField({ name: v }, 'name')).toBe('');
	});

	it('gives empty for a missing field or a null body', () => {
		expect(textField({}, 'name')).toBe('');
		expect(textField(null, 'name')).toBe('');
	});
});

describe('readJson', () => {
	// The whole point: it hands back unknown, so a caller has to say what it
	// expects. That is a compile-time property -- what is checked here is that
	// the value itself arrives intact.
	it('passes the parsed value through', async () => {
		expect(await readJson(carrying({ verdict: null }))).toEqual({ verdict: null });
	});

	it('rejects exactly as .json() does, rather than swallowing it', async () => {
		await expect(readJson(broken)).rejects.toThrow(SyntaxError);
	});
});
