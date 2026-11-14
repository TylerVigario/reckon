/**
 * What may be said about a material once it is in the catalogue: its name,
 * brand and SKU, whether it is taxed, what it is counted in, and whether it is
 * offered -- each changed on its own, in place (#lib/Detail) -- and what it
 * sells at, said as one choice (readPricing).
 *
 * What it is counted in is fixed once any of it has been received, as Odoo
 * ("You cannot change the unit of measure as there are already stock moves for
 * this product") and ERPNext refuse it once stock has moved; the database
 * holds that too (a_unit_is_kept_once_received).
 *
 * The keys are the columns' own names, as every registry's are.
 */
import {
	anId,
	cap,
	decimal,
	flag,
	oneOf,
	optional,
	parseAll,
	parseIn,
	required,
	type Parsed
} from './field-rules.ts';

export const MATERIAL_FIELDS = {
	name: required('What it is.', cap(120)),
	brand: optional(cap(80)),
	sku: optional(cap(40)),
	taxable: flag,
	unit_id: required('What it is counted in.', anId),
	active: flag
};

/** Each detail as a person reads it, for history and for refusals. */
export const MATERIAL_WORDS: Record<keyof typeof MATERIAL_FIELDS, string> = {
	name: 'Name',
	brand: 'Brand',
	sku: 'SKU',
	taxable: 'Taxed',
	unit_id: 'Counted in',
	active: 'Offered'
};

/** Parse one material field by name. An unknown name is refused. */
export function parseMaterialField(field: string, raw: string): Parsed {
	return parseIn(MATERIAL_FIELDS, field, raw);
}

/**
 * HOW IT IS PRICED, one choice: at the business's markup over what one cost,
 * at a markup of its own, or at a set price a unit -- from today, so lines
 * already on a draft keep what they were priced at.
 */
export const PRICED_BY = ['business', 'markup', 'price'] as const;
export type PricedBy = (typeof PRICED_BY)[number];

export const PRICING_FIELDS = {
	by: required('How it is priced.', oneOf([...PRICED_BY])),
	markup_pct: optional(decimal(7, 4)),
	price: optional(decimal(12, 4))
};

/** A pricing as a whole: the figure its choice needs, and only that one. */
export function readPricing(fields: Record<string, unknown>) {
	const { values, errors } = parseAll(PRICING_FIELDS, fields);
	if (values.by === 'markup' && values.markup_pct === null && !errors.markup_pct)
		errors.markup_pct = 'What markup.';
	if (values.by === 'price' && values.price === null && !errors.price)
		errors.price = 'What it sells at, a unit.';
	return { values, errors };
}

/** A material's pricing as one choice, and the figure that choice carries. */
export type Pricing = { by: PricedBy; markup_pct: string | null; price: string | null };

/**
 * What a material sells at, as the choice it is: a set price where one is in
 * force, else its own markup where it has one, else the business's.
 */
export function pricedBy(m: { markup_pct: string | null; listed: string | null }): Pricing {
	if (m.listed !== null) return { by: 'price', markup_pct: null, price: m.listed };
	if (m.markup_pct !== null) return { by: 'markup', markup_pct: m.markup_pct, price: null };
	return { by: 'business', markup_pct: null, price: null };
}
