import type { ClientInit } from '@sveltejs/kit/hooks';
import { page } from '$app/state';
import { readLocaleFrom } from '#lib/format.ts';
import { readCurrencyFrom } from '#lib/currency.ts';

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
	// Figures read in the person's locale, as the server wrote them: the root
	// layout carries it with every page.
	readLocaleFrom(() => (page.data.locale as string | undefined) ?? 'en-US');
	// And amounts in the business's currency, which it carries too.
	readCurrencyFrom(
		() => (page.data.operator as { currency?: string } | null | undefined)?.currency ?? 'USD'
	);
};
