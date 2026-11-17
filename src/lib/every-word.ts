/**
 * A list of every word of one of the database's types, once each, in the
 * order the screens offer them: `everyWord<BillingInterval>()(['weekly',
 * ...])`. A word the type lacks, or one of its words left out, is a type
 * error, so what a screen offers cannot drift from what the database takes
 * (#lib/server/db/database, generated from the migrations).
 */
export const everyWord =
	<W extends string>() =>
	<const L extends readonly W[]>(
		list: L & ([W] extends [L[number]] ? unknown : { missing: Exclude<W, L[number]> })
	): L =>
		list;
