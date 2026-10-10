/**
 * How many wrong passwords one address may try. Better Auth's own limiter runs
 * only on its HTTP routes, which this app does not mount -- sign-in is a form
 * action calling Better Auth directly -- so the limit lives here.
 *
 * Counted per client address, as adapter-node resolves it, and never per
 * account: a lock on an account would answer differently for an address that
 * has one, and tell anyone who tries five times which addresses do. Held in
 * memory: one process, and a restart forgives everyone.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const failures = new Map<string, number[]>();

function recent(address: string, now: number): number[] {
	const kept = (failures.get(address) ?? []).filter((at) => now - at < WINDOW_MS);
	if (kept.length) failures.set(address, kept);
	else failures.delete(address);
	return kept;
}

/** Seconds until this address may try again; 0 if it may now. */
export function waitFor(address: string, now = Date.now()): number {
	const kept = recent(address, now);
	return kept.length >= MAX_FAILURES ? Math.ceil((kept[0] + WINDOW_MS - now) / 1000) : 0;
}

export function recordFailure(address: string, now = Date.now()): void {
	failures.set(address, [...recent(address, now), now]);
	// Addresses that never come back would otherwise stay for ever.
	if (failures.size > 1000) for (const key of [...failures.keys()]) recent(key, now);
}

export function clearFailures(address: string): void {
	failures.delete(address);
}
