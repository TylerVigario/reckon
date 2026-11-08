import { normalizeIP } from '@better-auth/core/utils/ip';

/**
 * How many tries at a password one address may make. Better Auth's own limiter
 * runs only on its HTTP routes, which this app does not mount -- sign-in is a
 * form action calling Better Auth directly -- so the limit lives here.
 *
 * A try is taken before its password is checked, and a right password gives
 * the address its tries back. Counted only once a password had proved wrong,
 * any number sent at once all passed on a count none of them had yet added to.
 * A try the server fails to finish counts as well, and ages out as a wrong one
 * does.
 *
 * Counted per client address, as adapter-node resolves it, and never per
 * account: a lock on an account would answer differently for an address that
 * has one, and tell anyone who tries five times which addresses do. An IPv6
 * address counts as its /64, as Better Auth's own limiter keys it: a /64 is one
 * network, and a client on it may take any of its addresses, so counted one by
 * one it would never run out of tries. Held in memory: one process, and a
 * restart forgives everyone.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;

const tries = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
	const kept = (tries.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
	if (kept.length) tries.set(key, kept);
	else tries.delete(key);
	return kept;
}

/**
 * Takes one of this address's tries, before its password is checked: 0 when it
 * had one, else the seconds until it will. A try refused takes nothing.
 */
export function takeTry(address: string, now = Date.now()): number {
	const key = normalizeIP(address);
	const kept = recent(key, now);
	if (kept.length >= MAX_TRIES) return Math.ceil((kept[0] + WINDOW_MS - now) / 1000);
	tries.set(key, [...kept, now]);
	// Addresses that never come back would otherwise stay for ever.
	if (tries.size > 1000) for (const other of [...tries.keys()]) recent(other, now);
	return 0;
}

/** A right password: the address has its tries back. */
export function forgive(address: string): void {
	tries.delete(normalizeIP(address));
}
