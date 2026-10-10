import { Decimal } from './decimal.ts';

/**
 * A CHANGE MADE ON A PHONE, MERGED with what the server has, field by field,
 * against what the line was when the change began (its base): the three-way
 * merge every version control system makes.
 *
 *   a field only the phone changed      takes the phone's value
 *   a field only the server changed     keeps the server's
 *   a field both changed to one value   has it
 *   a field both changed differently    collides, and a person picks
 *
 * The fields are Add a line's (#lib/line-fields), in the words the form uses:
 * figures as typed, ids, and nothing for nothing.
 */
export const MERGED_FIELDS = [
	'description',
	'qty',
	'site_id',
	'bought_from',
	'ex_tax_cost',
	'tax_paid',
	'paid_by'
] as const;
export type MergedField = (typeof MERGED_FIELDS)[number];

/** The fields holding figures, which are one value however they are written. */
const FIGURES: readonly string[] = ['qty', 'ex_tax_cost', 'tax_paid'];

/** Whether two values of a field are the same: 30 and 30.00 are, "" and nothing are. */
export function same(field: string, a: string | undefined, b: string | undefined): boolean {
	const x = (a ?? '').trim();
	const y = (b ?? '').trim();
	if (FIGURES.includes(field) && /^-?\d+(\.\d+)?$/.test(x) && /^-?\d+(\.\d+)?$/.test(y))
		return Decimal.from(x).eq(y);
	return x === y;
}

export type Merge = {
	/** The line's fields once merged: what to save, but for what collided. */
	fields: Record<string, string>;
	/** Who each field that moved was taken from. */
	from: Partial<Record<MergedField, 'phone' | 'server'>>;
	/** The fields both changed differently. */
	collided: MergedField[];
};

export function merge(
	base: Record<string, string>,
	phone: Record<string, string>,
	server: Record<string, string>
): Merge {
	const fields: Record<string, string> = { ...server };
	const from: Merge['from'] = {};
	const collided: MergedField[] = [];
	for (const f of MERGED_FIELDS) {
		const mine = phone[f] ?? base[f];
		const theirs = server[f];
		const phoneMoved = !same(f, mine, base[f]);
		const serverMoved = !same(f, theirs, base[f]);
		if (phoneMoved && serverMoved && !same(f, mine, theirs)) collided.push(f);
		else if (phoneMoved) {
			fields[f] = mine ?? '';
			from[f] = 'phone';
		} else if (serverMoved) from[f] = 'server';
	}
	return { fields, from, collided };
}
