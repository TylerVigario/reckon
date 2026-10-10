/**
 * Where to go after signing in: somewhere on this site, or home.
 *
 * `next` arrives in the sign-in link, so anyone can write it. It is resolved
 * the way a browser resolves it, against this request's own address, and kept
 * only if it lands on the same site. Checking the text instead -- starts with
 * one slash, not two -- let through "/\example.com" and "/<tab>/example.com",
 * which a browser reads as another site (#29). SvelteKit then refused the
 * redirect itself, and the person, already signed in, got a 500.
 */
export function safeNext(next: unknown, origin: string): string {
	if (typeof next !== 'string' || !next.startsWith('/')) return '/';
	try {
		const to = new URL(next, origin);
		return to.origin === origin ? to.pathname + to.search + to.hash : '/';
	} catch {
		return '/';
	}
}
