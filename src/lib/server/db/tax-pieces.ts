import type { ColumnType } from 'kysely';
import type { TaxLevel } from './database.ts';

/**
 * One piece of the tax a line was charged: who levied it -- federal, state or
 * local -- and at what rate, as the site's area had it when the line was added
 * (#lib/server/tax-areas). The rate is the string Postgres writes, as every
 * NUMERIC is: inside JSON a number would be a float.
 *
 * A piece for one kind of sale alone says which, `kind`; a line keeps one only
 * for the kind it was sold as (line_pieces_are_for_its_kind). One with no kind,
 * or a null one as an area's pieces are read, falls on every kind its state
 * taxes.
 */
export type TaxPiece = {
	level: TaxLevel;
	jurisdiction: string;
	rate: string;
	kind?: string | null;
};

/**
 * invoice_line.tax_pieces, as database.ts types it: the list as pg parses it,
 * written as its JSON. A JS array handed to pg as it is would become a Postgres
 * array, not JSON.
 */
export type TaxPiecesColumn = ColumnType<TaxPiece[] | null, string | null, string | null>;
