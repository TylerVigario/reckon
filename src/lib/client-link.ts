/**
 * THE CLIENT'S LINK (0028): /invoice/<token>, which opens one sent invoice
 * without signing in. The token is 32 random bytes, written in base64url, so a
 * link cannot be guessed or counted towards; it is the whole of what lets the
 * page open, so nothing else about the invoice is in it.
 */

/** The page a link opens, and the data SvelteKit fetches for it: nothing wider. */
export const CLIENT_PAGE = /^\/invoice\/[A-Za-z0-9_-]{20,64}(\/__data\.json)?$/;

/** The link to an invoice, on the origin the request came in on. */
export const clientLink = (origin: string, token: string) => `${origin}/invoice/${token}`;
