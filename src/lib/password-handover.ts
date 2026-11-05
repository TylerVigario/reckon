/**
 * A password to hand someone, carried from the screen that made it to their
 * page (#lib/server/handover). It is kept in this tab's memory and nowhere
 * else -- not the address, the history or the browser's storage -- and their
 * page takes it once, so it is not there to show again after a reload.
 */
let held: { id: string; password: string } | null = null;

/** Called by whoever was answered with it, before going to the person's page. */
export function carry(id: string, password: string): void {
	held = { id, password };
}

/** The password carried for this person, once; null on every later ask. */
export function take(id: string): string | null {
	const password = held?.id === id ? held.password : null;
	held = null;
	return password;
}
