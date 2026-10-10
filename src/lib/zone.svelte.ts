import { page } from '$app/state';

/**
 * The person's time zone, as the root layout loaded it: the one on their user
 * record, or the business's until theirs is set. Every moment on a page is
 * drawn in it, so the page the server draws and the page in the browser show
 * the same time, on every device they use.
 *
 * Read from `page` and never held in a module variable, for the reason money()
 * gives: a module variable is shared by every request the server is rendering
 * at once.
 */
export function personalZone(): string {
	return (page.data.zone as string | undefined) ?? 'UTC';
}
