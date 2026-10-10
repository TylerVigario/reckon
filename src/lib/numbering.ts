/**
 * An invoice's number, from the operator's format: its last run of zeros is
 * where the number goes, padded to the run's length -- INV-0000 and 12 make
 * INV-0012, and 12345 makes INV-12345. A run of zeros earlier in the format is
 * part of the format: 2026-0000 numbers 2026-0012.
 */
export function numberFrom(format: string, n: number): string {
	const last = /0+(?!.*0)/.exec(format);
	if (!last) return `${format}${n}`;
	const digits = String(n).padStart(last[0].length, '0');
	return format.slice(0, last.index) + digits + format.slice(last.index + last[0].length);
}
