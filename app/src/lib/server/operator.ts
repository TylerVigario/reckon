import { getTableColumns, sql } from 'drizzle-orm';
import { db, type Reader } from './db';
import { operator } from './db/schema';
import { snake } from './db/rows';

/**
 * The operator row as the settings pages read it: every column by its own
 * name, except the logo's bytes, which only /operator/logo serves -- a page
 * needs to know there is one, not to carry it.
 */
export async function operatorRow(r: Reader = db) {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- taken out on purpose
	const { logo, ...columns } = getTableColumns(operator);
	const [row] = await r
		.select({ ...columns, hasLogo: sql<boolean>`${operator.logo} is not null` })
		.from(operator)
		.limit(1);
	return row ? snake(row) : null;
}

export type OperatorRow = NonNullable<Awaited<ReturnType<typeof operatorRow>>>;
