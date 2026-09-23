import { describe, expect, it } from 'vitest';
import {
	cap,
	decimal,
	flag,
	oneOf,
	optional,
	orDefault,
	phone,
	required,
	whole
} from './field-rules';

/**
 * The rules that decide what a value may be.
 *
 * Both the page and the endpoint parse through these, so a rule that changes
 * changes both at once -- which is the point of the registry, and the reason
 * these are worth pinning. Each case here is a sentence the module already
 * claims about itself.
 */

describe('flag', () => {
	// This is the one that has actually bitten. postgres.js hands the STRING
	// 'true' to a boolean column as FALSE: no error, update reports success,
	// wrong value in the row. So the rule must return a real boolean, and
	// `typeof` is the assertion that says so -- toBe(true) alone would pass
	// for the string.
	it('returns a real boolean, not the word', () => {
		const t = flag('true');
		expect(t.ok && typeof t.value).toBe('boolean');
		expect(t.ok && t.value).toBe(true);
	});

	it('takes the words a form or a person might send', () => {
		for (const yes of ['true', 'yes', 'on', 'TRUE', ' On '])
			expect(flag(yes)).toEqual({ ok: true, value: true });
		for (const no of ['false', 'no', 'off', 'OFF'])
			expect(flag(no)).toEqual({ ok: true, value: false });
	});

	it('refuses anything else rather than guessing', () => {
		for (const v of ['1', '0', '', 'maybe', 'null']) expect(flag(v).ok).toBe(false);
	});
});

describe('decimal', () => {
	// Money and rates are NUMERIC. Parsing one into a JS number is how cents go
	// missing, so the value stays the string it arrived as.
	it('keeps the value a string', () => {
		const r = decimal(10, 2)('1234.50');
		expect(r.ok && typeof r.value).toBe('string');
		expect(r.ok && r.value).toBe('1234.50');
	});

	it('does not round a trailing zero away', () => {
		expect(decimal(10, 2)('0.10')).toEqual({ ok: true, value: '0.10' });
	});

	it('counts digits either side the way the column does', () => {
		expect(decimal(5, 2)('999.99').ok).toBe(true);
		expect(decimal(5, 2)('1000.00').ok).toBe(false); // four before the point, room is three
		expect(decimal(5, 2)('9.999').ok).toBe(false); // three after, scale is two
	});

	it('says which half was wrong', () => {
		const tooMany = decimal(5, 2)('9.999');
		expect(!tooMany.ok && tooMany.why).toMatch(/decimal places/);
		const tooBig = decimal(5, 2)('1000.00');
		expect(!tooBig.ok && tooBig.why).toMatch(/before the decimal/);
	});

	it('refuses a negative', () => {
		expect(decimal(10, 2)('-1.00').ok).toBe(false);
	});
});

describe('whole', () => {
	it('takes a whole number at or above the floor', () => {
		expect(whole(0)('0')).toEqual({ ok: true, value: 0 });
		expect(whole(1)('0').ok).toBe(false);
	});

	// int4 is what the column is. A number past it would be refused by Postgres
	// after the save looked like it worked.
	it('refuses more than an int4 holds', () => {
		expect(whole(0)('2147483647').ok).toBe(true);
		expect(whole(0)('2147483648').ok).toBe(false);
	});

	it('refuses a decimal, a sign, or empty', () => {
		for (const v of ['1.5', '-1', '', ' 1']) expect(whole(0)(v).ok).toBe(false);
	});
});

describe('phone', () => {
	// It prints at the top of an invoice, so it is kept exactly as typed --
	// normalising to E.164 would be this file deciding how the business looks.
	it('keeps the number as it was written', () => {
		expect(phone('559-900-1400')).toEqual({ ok: true, value: '559-900-1400' });
		expect(phone('(559) 900 1400')).toEqual({ ok: true, value: '(559) 900 1400' });
		expect(phone('5599001400')).toEqual({ ok: true, value: '5599001400' });
	});

	it('allows one extension and keeps it', () => {
		expect(phone('559-900-1400 x12')).toEqual({ ok: true, value: '559-900-1400 x12' });
		expect(phone('559-900-1400 x12 x13').ok).toBe(false);
	});

	it('holds the E.164 bounds', () => {
		expect(phone('123456').ok).toBe(false); // six digits dials nothing
		expect(phone('1234567').ok).toBe(true);
		expect(phone('+123456789012345').ok).toBe(true); // fifteen, the maximum
		expect(phone('+1234567890123456').ok).toBe(false);
	});

	it('refuses letters in the number itself', () => {
		expect(phone('559-EAT-FOOD').ok).toBe(false);
	});
});

describe('the wrappers', () => {
	// required() takes the refusal first, because the words belong to the
	// field: "A client needs a name" is not "Required."
	it('required refuses blank and whitespace, in its own words', () => {
		const named = required('A client needs a name.');
		expect(named('')).toEqual({ ok: false, why: 'A client needs a name.' });
		expect(named('   ').ok).toBe(false);
		expect(named('a')).toEqual({ ok: true, value: 'a' });
	});

	it('required trims before it judges, and before it passes on', () => {
		expect(required('needed')(' a ')).toEqual({ ok: true, value: 'a' });
	});

	it('orDefault fills the column default rather than refusing', () => {
		expect(orDefault('USD')('')).toEqual({ ok: true, value: 'USD' });
		expect(orDefault('USD')('GBP')).toEqual({ ok: true, value: 'GBP' });
	});

	it('optional turns blank into null rather than into an error', () => {
		expect(optional(whole(0))('')).toEqual({ ok: true, value: null });
		expect(optional(whole(0))('3')).toEqual({ ok: true, value: 3 });
	});

	it('oneOf refuses a value outside the vocabulary', () => {
		const crew = oneOf(['one', 'team']);
		expect(crew('team')).toEqual({ ok: true, value: 'team' });
		expect(crew('both').ok).toBe(false);
	});

	it('cap refuses past its length', () => {
		expect(cap(3)('abc').ok).toBe(true);
		expect(cap(3)('abcd').ok).toBe(false);
	});
});
