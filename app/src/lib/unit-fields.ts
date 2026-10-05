/**
 * What may be said about a unit: what things are counted in.
 *
 * The operator's own list -- each, the foot, a box of 25, a gallon -- named once
 * and used wherever stock or a line counts something. A unit says how it is
 * written beside a figure, and how many places a quantity in it may have: 0 for
 * whole things, at most 4, as quantities are held.
 */
import { cap, optional, parseIn, required, whole, type Parsed } from './field-rules.ts';

export type { Parsed };

/** How many places a quantity may have, as the list offers them. */
export const PLACES = [0, 1, 2, 3, 4] as const;

export const UNIT_FIELDS = {
	name: required('A unit needs a name.', cap(40)),
	// Written beside a figure: "ft". Empty writes the name.
	short: optional(cap(12)),
	places: required('How many places.', whole(0, 4))
};

export function parseUnitField(field: string, raw: string): Parsed {
	return parseIn(UNIT_FIELDS, field, raw);
}

/** "Whole numbers", "To 2 places": a unit's places, said. */
export const placesWord = (places: number) =>
	places === 0 ? 'Whole numbers' : `To ${places} place${places === 1 ? '' : 's'}`;
