// Column shapes every table uses, so each convention is stated once.

import { sql } from 'drizzle-orm';
import {
	check,
	customType,
	date,
	numeric,
	timestamp,
	uuid,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { MONEY_SCALE, MONEY_WHOLE } from '../../../currency.ts';

/**
 * A uuid the database makes. v7 is time-ordered, so new rows append to the
 * primary-key index rather than landing at random in it, and a row inserted by
 * hand in psql gets one too.
 */
export const id = () =>
	uuid()
		.primaryKey()
		.default(sql`uuidv7()`);

/** Every timestamp carries its zone. */
export const tstz = () => timestamp({ withTimezone: true });

export const createdAt = () => tstz().defaultNow().notNull();

export const updatedAt = () =>
	tstz()
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date());

/**
 * A calendar date, as the string Postgres writes: "2026-03-14". Never a JS
 * Date, which is a moment, and which west of Greenwich turns a date into the
 * day before.
 */
export const day = () => date({ mode: 'string' });

/**
 * NUMERIC, as the string Postgres writes. Arithmetic on it goes through
 * #lib/decimal, never a JS number.
 */
export const decimal = (precision: number, scale: number) => numeric({ precision, scale });

/**
 * An amount of money, at as many places as any currency has: a dollar amount
 * is held as 95.500, a yen amount as 95.000. What is in it is rounded to the
 * business's currency's own places before it gets here (#lib/currency).
 */
export const money = () => decimal(MONEY_WHOLE + MONEY_SCALE, MONEY_SCALE);

/** Raw bytes. Drizzle 0.45 has no built-in for Postgres's `bytea`. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => 'bytea'
});

/**
 * Lowercase words joined by single hyphens: `harbor-light-dental`. A slug is a
 * URL, so the database refuses anything else; #lib/slug makes one.
 */
export const slugFormat = (name: string, column: AnyPgColumn) =>
	check(name, sql`${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`);

/** Stored lowercased, so one plain unique index answers every lookup. */
export const lowercaseEmail = (name: string, column: AnyPgColumn) =>
	check(name, sql`${column} = lower(${column})`);

/** The column is one of these words. */
export const oneOf = (name: string, column: AnyPgColumn, words: readonly string[]) =>
	check(name, sql`${column} = ANY (ARRAY[${sql.raw(words.map((w) => `'${w}'`).join(', '))}])`);

/** At least zero. */
export const nonNegative = (name: string, column: AnyPgColumn) => check(name, sql`${column} >= 0`);
