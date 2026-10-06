/**
 * What may be said about stock received: a lot, and the material it is of when
 * that is new to the catalogue.
 *
 * A lot is what one receipt brought in -- how much, of what, on which day, from
 * whom -- and what all of it cost before tax and in tax, as the receipt says
 * them. A unit's share is worked out from those, never stored. Who paid is a
 * person, who is owed it back, or the business.
 *
 * The keys are the columns' own names, as every registry's are.
 */
import {
	anId,
	cap,
	decimal,
	isoDate,
	money,
	optional,
	orDefault,
	parseAll,
	required
} from './field-rules.ts';

export const LOT_FIELDS = {
	// A lot is always of a material. Left empty on the form when the material
	// is named there for the first time, it is the new one's (readLot).
	material_id: required('Which material.', anId),
	supplier: optional(cap(80)),
	received_on: required('Which day it arrived.', isoDate),
	qty_received: required('How much arrived.', decimal(12, 4)),
	ex_tax_cost: required('What all of it cost before tax.', money),
	tax_paid: orDefault('0', money),
	// Empty is the business.
	paid_by: optional(anId)
};

/** A material named while it is received: what it is, and what it is counted in. */
export const NEW_MATERIAL_FIELDS = {
	name: required('What it is.', cap(120)),
	unit_id: required('What it is counted in.', anId)
};

/**
 * A lot as a whole: what each field says, then what they say together -- a
 * material, or a new one named; something received; and no more places in the
 * quantity than its unit counts in. `places` is that unit's, or null when no
 * unit is known yet.
 */
export function readLot(fields: Record<string, unknown>, places: number | null) {
	const lot = parseAll(LOT_FIELDS, fields);
	const named = typeof fields.material_id !== 'string' || fields.material_id.trim() === '';
	const fresh = named ? parseAll(NEW_MATERIAL_FIELDS, fields) : null;
	if (named) {
		delete lot.errors.material_id;
		lot.values.material_id = null;
	}
	const errors: Record<string, string> = { ...lot.errors, ...(fresh?.errors ?? {}) };
	const qty = lot.values.qty_received;
	if (typeof qty === 'string' && !errors.qty_received) {
		const [, after = ''] = qty.split('.');
		if (!/[1-9]/.test(qty)) errors.qty_received = 'Something has to have arrived.';
		else if (places !== null && after.replace(/0+$/, '').length > places)
			errors.qty_received =
				places === 0
					? 'Whole numbers in this unit.'
					: `At most ${places} decimal place${places === 1 ? '' : 's'} in this unit.`;
	}
	return { values: lot.values, material: fresh?.values ?? null, errors };
}
