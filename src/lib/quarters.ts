/**
 * A QUARTER'S FIRST DAY, which is when a sales tax rate or boundary changes:
 * California's districts, and every state of the Streamlined Sales and Use Tax
 * Agreement (s. 304(A)(2), s. 305(A) and (C)). Days as YYYY-MM-DD, as a date
 * input sends them and Postgres writes them.
 */

/** The first day of the quarter `day` falls in: 2026-11-18 is in 2026-10-01's. */
export function quarterOf(day: string): string {
	const month = Number(day.slice(5, 7));
	const first = month - ((month - 1) % 3);
	return `${day.slice(0, 4)}-${String(first).padStart(2, '0')}-01`;
}

/** The first day of the quarter after the one `day` falls in. */
export function nextQuarter(day: string): string {
	const [year, month] = quarterOf(day).split('-').map(Number);
	return month === 10 ? `${year + 1}-01-01` : `${year}-${String(month + 3).padStart(2, '0')}-01`;
}
