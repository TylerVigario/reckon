import type { ClientInit } from '@sveltejs/kit/hooks';

/**
 * Temporal, before the app starts.
 *
 * Dates, moments and durations are worked with through Temporal, everywhere.
 * A browser that has it keeps its own. One that does not loads the polyfill
 * first: SvelteKit waits for this before the first page is drawn, so nothing
 * runs without it. The polyfill is one of the app's own files, so the service
 * worker keeps it for offline like the rest, and a browser that never needs it
 * never fetches it.
 */
export const init: ClientInit = async () => {
	if (!('Temporal' in globalThis)) await import('temporal-polyfill/global');
};
