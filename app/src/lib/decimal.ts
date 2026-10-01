/**
 * Exact decimal arithmetic, for money, rates, hours and miles.
 *
 * A Decimal is a BigInt count of units at a fixed number of decimal places:
 * 12.50 is 1250 at scale 2. Adding, subtracting and multiplying are exact.
 * Dividing is not, in general, so it never happens on a Decimal: a division
 * makes a Ratio, an exact fraction, and a Ratio becomes a Decimal only by
 * being rounded to a stated number of places by a stated rule. Every rounding
 * in a calculation is therefore visible where it happens, and a chain of
 * steps rounds once, at the end, rather than at each step.
 *
 * Values arrive from Postgres as NUMERIC strings and leave as strings; no
 * figure ever passes through a JS number on the way.
 */

export type Rounding = 'half_up' | 'half_even';

const TEN = 10n;
const pow10 = (n: number): bigint => TEN ** BigInt(n);

/** a / b rounded to an integer, b > 0. half_up takes a tie away from zero. */
function divRound(a: bigint, b: bigint, mode: Rounding): bigint {
	if (b <= 0n) throw new RangeError('Division by zero or a negative divisor.');
	const negative = a < 0n;
	const m = negative ? -a : a;
	let q = m / b;
	const r = m % b;
	const twice = r * 2n;
	if (twice > b || (twice === b && (mode === 'half_up' || q % 2n === 1n))) q += 1n;
	return negative ? -q : q;
}

const NUMERIC = /^([+-]?)(\d+)(?:\.(\d*))?$/;

export class Decimal {
	/** The value is units / 10^scale. */
	readonly units: bigint;
	readonly scale: number;

	// Fields assigned by hand rather than as parameter properties, so node can
	// run this file by stripping its types: scripts/ import it as it is.
	private constructor(units: bigint, scale: number) {
		this.units = units;
		this.scale = scale;
	}

	static of(units: bigint, scale = 0): Decimal {
		if (!Number.isInteger(scale) || scale < 0) throw new RangeError(`Bad scale ${scale}.`);
		return new Decimal(units, scale);
	}

	/** From a NUMERIC string, a bigint, or a safe integer. Never from a fraction in a JS number. */
	static from(v: string | bigint | number | Decimal): Decimal {
		if (v instanceof Decimal) return v;
		if (typeof v === 'bigint') return new Decimal(v, 0);
		if (typeof v === 'number') {
			if (!Number.isSafeInteger(v)) throw new TypeError(`Not an exact integer: ${v}.`);
			return new Decimal(BigInt(v), 0);
		}
		const m = NUMERIC.exec(v.trim());
		if (!m) throw new TypeError(`Not a decimal: ${JSON.stringify(v)}.`);
		const frac = m[3] ?? '';
		const units = BigInt(m[2] + frac);
		return new Decimal(m[1] === '-' ? -units : units, frac.length);
	}

	/** Null and undefined pass through, for the many columns that may be empty. */
	static maybe(v: string | null | undefined): Decimal | null {
		return v === null || v === undefined || v === '' ? null : Decimal.from(v);
	}

	static readonly ZERO = new Decimal(0n, 0);

	/** This value's units at a larger scale. */
	private at(scale: number): bigint {
		return this.units * pow10(scale - this.scale);
	}

	add(o: Decimal | string | bigint | number): Decimal {
		const b = Decimal.from(o);
		const s = Math.max(this.scale, b.scale);
		return new Decimal(this.at(s) + b.at(s), s);
	}

	sub(o: Decimal | string | bigint | number): Decimal {
		const b = Decimal.from(o);
		const s = Math.max(this.scale, b.scale);
		return new Decimal(this.at(s) - b.at(s), s);
	}

	mul(o: Decimal | string | bigint | number): Decimal {
		const b = Decimal.from(o);
		return new Decimal(this.units * b.units, this.scale + b.scale);
	}

	/** An exact fraction. Round it to get a Decimal back. */
	div(o: Decimal | string | bigint | number): Ratio {
		return Ratio.of(this).div(o);
	}

	neg(): Decimal {
		return new Decimal(-this.units, this.scale);
	}

	/** To `places` decimal places. */
	round(places: number, mode: Rounding = 'half_up'): Decimal {
		if (places >= this.scale) return new Decimal(this.at(places), places);
		return new Decimal(divRound(this.units, pow10(this.scale - places), mode), places);
	}

	/** Rounded to the nearest whole number. */
	toBigInt(mode: Rounding = 'half_up'): bigint {
		return this.round(0, mode).units;
	}

	cmp(o: Decimal | string | bigint | number): -1 | 0 | 1 {
		const b = Decimal.from(o);
		const s = Math.max(this.scale, b.scale);
		const x = this.at(s);
		const y = b.at(s);
		return x < y ? -1 : x > y ? 1 : 0;
	}

	eq(o: Decimal | string | bigint | number): boolean {
		return this.cmp(o) === 0;
	}
	gt(o: Decimal | string | bigint | number): boolean {
		return this.cmp(o) > 0;
	}
	lt(o: Decimal | string | bigint | number): boolean {
		return this.cmp(o) < 0;
	}

	isZero(): boolean {
		return this.units === 0n;
	}

	static max(a: Decimal, b: Decimal): Decimal {
		return a.cmp(b) >= 0 ? a : b;
	}
	static min(a: Decimal, b: Decimal): Decimal {
		return a.cmp(b) <= 0 ? a : b;
	}

	/** Exactly as many places as the scale: "12.50", "-0.05", "3". */
	toString(): string {
		const negative = this.units < 0n;
		const digits = (negative ? -this.units : this.units).toString().padStart(this.scale + 1, '0');
		const whole = digits.slice(0, digits.length - this.scale);
		const frac = this.scale ? '.' + digits.slice(digits.length - this.scale) : '';
		return `${negative ? '-' : ''}${whole}${frac}`;
	}

	/** Rounded to `places` and printed: what NUMERIC(p, places) would hold. */
	toFixed(places: number, mode: Rounding = 'half_up'): string {
		return this.round(places, mode).toString();
	}

	toJSON(): string {
		return this.toString();
	}
}

/** An exact fraction, for the steps of a calculation between two roundings. */
export class Ratio {
	readonly num: bigint;
	readonly den: bigint;

	private constructor(num: bigint, den: bigint) {
		this.num = num;
		this.den = den;
	}

	static of(v: Decimal | string | bigint | number): Ratio {
		const d = Decimal.from(v);
		return new Ratio(d.units, pow10(d.scale));
	}

	mul(o: Decimal | Ratio | string | bigint | number): Ratio {
		const b = o instanceof Ratio ? o : Ratio.of(o);
		return new Ratio(this.num * b.num, this.den * b.den);
	}

	div(o: Decimal | Ratio | string | bigint | number): Ratio {
		const b = o instanceof Ratio ? o : Ratio.of(o);
		if (b.num === 0n) throw new RangeError('Division by zero.');
		const sign = b.num < 0n ? -1n : 1n;
		return new Ratio(this.num * b.den * sign, this.den * b.num * sign);
	}

	add(o: Decimal | Ratio | string | bigint | number): Ratio {
		const b = o instanceof Ratio ? o : Ratio.of(o);
		return new Ratio(this.num * b.den + b.num * this.den, this.den * b.den);
	}

	/** To `places` decimal places, by `mode`. */
	round(places: number, mode: Rounding = 'half_up'): Decimal {
		return Decimal.of(divRound(this.num * pow10(places), this.den, mode), places);
	}

	/** To a whole number, by `mode`. */
	toBigInt(mode: Rounding = 'half_up'): bigint {
		return divRound(this.num, this.den, mode);
	}
}

/** The sum of NUMERIC strings, or nothing. Null and empty count as nothing. */
export function sum(xs: Iterable<Decimal | string | null | undefined>): Decimal {
	let total = Decimal.ZERO;
	for (const x of xs) if (x !== null && x !== undefined && x !== '') total = total.add(x);
	return total;
}

/** A money total, as the two-place string a page shows. */
export const sumMoney = (xs: Iterable<Decimal | string | null | undefined>): string =>
	sum(xs).toFixed(2);
