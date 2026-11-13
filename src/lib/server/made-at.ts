/**
 * When a phone says a change was made: a moment, no later than now -- a phone
 * whose clock runs ahead cannot make a change in the future -- or nothing. Its
 * history keeps it beside when the change arrived (#lib/server/db asUser).
 */
export function madeAt(said: string): string | null {
	if (!said) return null;
	let at: Temporal.Instant;
	try {
		at = Temporal.Instant.from(said);
	} catch {
		return null;
	}
	const now = Temporal.Now.instant();
	return (Temporal.Instant.compare(at, now) > 0 ? now : at).toString();
}
