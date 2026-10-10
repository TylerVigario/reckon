/**
 * How long unbilled work has waited, in bands: the home page's three rows.
 *
 * One definition for both ends: the server puts each entry in a band by its
 * key, and the page writes each band's name from its bounds (#lib/format's
 * dayRange), so the edges cannot be one thing in the query and another on the
 * screen. The tone is how urgently the band reads.
 */
export const AGES = [
	{ key: 'week', from: 0, to: 7, tone: 'good' },
	{ key: 'month', from: 8, to: 30, tone: 'warn' },
	{ key: 'older', from: 31, to: null, tone: 'crit' }
] as const;

export type Age = (typeof AGES)[number]['key'];

/** The band a piece of work waiting this many days is in. */
export const ageOf = (days: number): Age =>
	(AGES.find((a) => a.to === null || days <= a.to) ?? AGES[AGES.length - 1]).key;
