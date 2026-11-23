/**
 * A TAX AREA AS A PERSON TYPES IT, from a state's own table, where no
 * authority answers for an address (#lib/server/typed-areas): what the state
 * calls it and its code for it, and its rate from a day, piece by piece -- who
 * levies what. The pages and their endpoints both import this, so a page
 * answers as a person types and the endpoint checks again.
 *
 * ONLY THESE KEYS CAN BE WRITTEN. A field named in a request is looked up here
 * and nowhere else.
 */
import {
	anId,
	cap,
	isoDate,
	oneOf,
	optional,
	parseIn,
	percentage,
	required,
	type Parsed
} from './field-rules.ts';
import { Decimal } from './decimal.ts';
import { NO_STATE_TAX, stateName, type State } from './us-states.ts';

export const AREA_FIELDS = {
	// As the state's table names it: Reno, Washoe County.
	name: required('What the state calls it.', cap(100)),
	// The state's code for it, where its table gives one.
	code: optional(cap(20))
};

/** Parse one field of an area by name. An unknown name is refused. */
export function parseAreaField(name: string, raw: string): Parsed {
	return parseIn(AREA_FIELDS, name, raw);
}

/** Who levies a piece, how much, and on what. */
export const PIECE_FIELDS = {
	level: oneOf(['state', 'local']),
	// As the state's table names them: Nevada, Washoe County.
	jurisdiction: required('Who levies it.', cap(100)),
	code: optional(cap(20)),
	rate_pct: required('How much, as a percentage.', percentage),
	// The one kind of sale it falls on, or none for every kind the state taxes.
	sale_kind_id: optional(anId)
};

/** The day a rate took effect. */
export const parseFrom = (raw: string): Parsed =>
	required('The day it took effect.', isoDate)(raw.trim());

/**
 * One piece of a rate, as it is written: on every kind of sale the state
 * taxes, or on one kind alone (`sale_kind_id`), whether or not the state taxes
 * that kind.
 */
export type TypedPiece = {
	level: 'state' | 'local';
	jurisdiction: string;
	code: string | null;
	rate_pct: string;
	sale_kind_id: string | null;
};

/** As many pieces as any place's rate has, and more. */
const MOST_PIECES = 12;

/**
 * A rate's pieces, as a person typed them for `state`: errors are keyed by
 * where they are -- `pieces` for the rate as a whole, `pieces.2.rate_pct` for
 * one field of one piece -- so a page can put each under its own box.
 *
 * The state levies once on every kind, and once on each kind it taxes alone;
 * a state with no tax of its own -- Alaska's and Montana's are local -- not at
 * all. Each jurisdiction levies once in a rate on every kind, and once on each
 * kind alone, as the schema says (tax_piece_once_in_a_set): Richmond levies
 * its local sales tax, and a meals tax of its own. And a rate of nothing is no
 * tax: a place where nobody levies anything needs no area.
 */
export function parsePieces(
	raw: unknown,
	state: State
): { pieces: TypedPiece[]; errors: Record<string, string> } {
	const errors: Record<string, string> = {};
	if (!Array.isArray(raw) || raw.length === 0)
		return { pieces: [], errors: { pieces: 'Who levies what: at least one piece.' } };
	if (raw.length > MOST_PIECES)
		return { pieces: [], errors: { pieces: `At most ${MOST_PIECES} pieces.` } };

	const pieces: TypedPiece[] = [];
	raw.forEach((p: unknown, i) => {
		if (typeof p !== 'object' || p === null || Array.isArray(p)) {
			errors[`pieces.${i}`] = 'Expected a piece.';
			return;
		}
		const piece: Record<string, string | null> = {};
		for (const name of Object.keys(PIECE_FIELDS)) {
			const v = (p as Record<string, unknown>)[name];
			if (v !== null && v !== undefined && typeof v !== 'string' && typeof v !== 'number') {
				errors[`pieces.${i}.${name}`] = 'Expected a value, not a structure.';
				continue;
			}
			const parsed = parseIn(PIECE_FIELDS, name, v === null || v === undefined ? '' : String(v));
			if (parsed.ok) piece[name] = parsed.value === null ? null : String(parsed.value);
			else errors[`pieces.${i}.${name}`] = parsed.why;
		}
		pieces.push(piece as TypedPiece);
	});
	if (Object.keys(errors).length) return { pieces: [], errors };

	pieces.forEach((p, i) => {
		const on = (q: TypedPiece) => q.sale_kind_id === p.sale_kind_id;
		if (p.level === 'state' && NO_STATE_TAX.includes(state))
			errors[`pieces.${i}.level`] =
				`${stateName(state)} levies no sales tax of its own: its pieces are local.`;
		else if (p.level === 'state' && pieces.findIndex((q) => q.level === 'state' && on(q)) !== i)
			errors[`pieces.${i}.level`] = p.sale_kind_id
				? 'The state levies once on a kind.'
				: 'The state levies once.';
		else if (
			pieces.findIndex(
				(q) =>
					q.level === p.level &&
					on(q) &&
					q.jurisdiction.toLowerCase() === p.jurisdiction.toLowerCase()
			) !== i
		)
			errors[`pieces.${i}.jurisdiction`] = p.sale_kind_id
				? 'Each levies once on a kind.'
				: 'Each levies once in a rate.';
	});
	if (Object.keys(errors).length) return { pieces: [], errors };

	if (pieces.every((p) => Decimal.from(p.rate_pct).isZero()))
		return {
			pieces: [],
			errors: { pieces: 'A rate of nothing is no tax: a place with none needs no area.' }
		};
	return { pieces, errors };
}
