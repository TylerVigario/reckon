import { page } from '$app/state';

/**
 * The business's time zone (#26), as the root layout loaded it from the
 * operator's settings.
 *
 * Read from `page` and never held in a module variable, for the reason money()
 * gives: a module variable is shared by every request the server is rendering
 * at once. UTC only where there is no operator yet.
 */
export function businessZone(): string {
	const operator = page.data.operator as { timezone?: string } | null | undefined;
	return operator?.timezone ?? 'UTC';
}
