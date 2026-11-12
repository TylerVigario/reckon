/**
 * WHOSE WORK THIS PHONE IS DOING NOW (12 November 2026): the person signed in,
 * as the page says -- from the server, or from its last copy, offline. Unsent
 * work on the phone -- the capture queue (#lib/queue) and running timers
 * (#lib/timers) -- is stamped with whoever made it, shown only to them, and
 * sent only under their session, whenever that is. Someone else signing in on
 * the same phone never sees or sends it, and signing out deletes none of it:
 * it waits for its maker.
 *
 * Set by the root layout in the browser as the page loads, before anything on
 * it reads the queue; null signed out, when nothing is shown or sent.
 */
let owner: string | null = null;

/** Say who is signed in now, or null. */
export function setOwner(id: string | null) {
	owner = id;
}

/** Who is signed in now, or null. */
export const currentOwner = () => owner;
