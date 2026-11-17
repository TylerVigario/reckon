import type { ColumnType, NumericString } from 'kysely';

/**
 * A NUMERIC column, as database.ts types it: the string Postgres writes
 * ("95.500"), as pg returns it, and written as a string -- money never passes
 * through a JS number (#lib/server/db).
 *
 * Typed as Kysely's NumericString rather than plain string for what happens
 * inside JSON. Rows nested with jsonArrayFrom or jsonObjectFrom
 * (kysely/helpers/postgres) arrive through JSON.parse, where a NUMERIC is a JS
 * number, and Kysely's helpers type a NumericString there as `number`. So a
 * figure nested without a cast to text reads as a number, which nothing that
 * takes money accepts, and fails the type check rather than losing its places.
 */
export type NumericColumn = ColumnType<NumericString, string, string>;
