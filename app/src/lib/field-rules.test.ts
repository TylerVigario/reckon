import { describe, expect, it } from 'vitest';
import {
	anId,
	cap,
	decimal,
	flag,
	isoDate,
	oneOf,
	optional,
	orDefault,
	phone,
	parseAll,
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

describe('isoDate', () => {
	it('takes a day as a date input sends it', () => {
		expect(isoDate('2026-09-01')).toEqual({ ok: true, value: '2026-09-01' });
	});

	// Date() would roll 30 February into 2 March and call it valid. A price
	// that starts on a day that does not exist is a typo, not March.
	it('refuses a day that does not exist', () => {
		expect(isoDate('2026-02-30').ok).toBe(false);
		expect(isoDate('2026-13-01').ok).toBe(false);
	});

	it('refuses anything that is not YYYY-MM-DD', () => {
		for (const v of ['1/9/2026', '2026-9-1', 'yesterday']) expect(isoDate(v).ok).toBe(false);
	});
});

describe('anId', () => {
	it('takes a uuid and nothing else', () => {
		expect(anId('55555555-0000-0000-0000-000000000001').ok).toBe(true);
		expect(anId('bravo-farms').ok).toBe(false);
	});
});

describe('parseAll', () => {
	const registry = { name: required('A name.'), rate: optional(decimal(12, 2)) };

	it('parses every field of the registry, sent or not', () => {
		const { values, errors } = parseAll(registry, { rate: '80.00' });
		expect(values).toEqual({ rate: '80.00' });
		expect(errors).toEqual({ name: 'A name.' });
	});

	it('refuses a structure where a value belongs, by name', () => {
		expect(parseAll(registry, { name: ['x'] }).errors.name).toBe(
			'Expected a value, not a structure.'
		);
	});
});
