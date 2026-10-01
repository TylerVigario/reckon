/**
 * Rows in the shape the pages read.
 *
 * The schema's keys are camelCase, as Drizzle has them; the pages, the field
 * registries and the API speak snake_case, the columns' own names. These
 * convert between the two, typed, so a renamed column is a compile error at
 * both ends rather than an undefined on a screen.
 */

type Snake<S extends string> = S extends `${infer H}${infer T}`
	? `${H extends Lowercase<H> ? H : `_${Lowercase<H>}`}${Snake<T>}`
	: S;
type Camel<S extends string> = S extends `${infer H}_${infer T}`
	? `${H}${Capitalize<Camel<T>>}`
	: S;

export type SnakeKeys<T> = { [K in keyof T as K extends string ? Snake<K> : K]: T[K] };
export type CamelKeys<T> = { [K in keyof T as K extends string ? Camel<K> : K]: T[K] };

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** A row with its keys as the columns are named. */
export function snake<T extends object>(row: T): SnakeKeys<T> {
	return Object.fromEntries(Object.entries(row).map(([k, v]) => [toSnake(k), v])) as SnakeKeys<T>;
}

/** Field values named as columns, keyed as the schema has them, for an insert or an update. */
export function camel<T extends object>(fields: T): CamelKeys<T> {
	return Object.fromEntries(
		Object.entries(fields).map(([k, v]) => [toCamel(k), v])
	) as CamelKeys<T>;
}
