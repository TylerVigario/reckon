import { page } from '$app/state';
import { formatMoney } from './format';

/**
 * A figure in the operator's own currency.
 *
 * operator.currency is loaded by the root layout, so every screen already has
 * it without asking -- which is why this can be a plain call in the markup
 * rather than a value threaded through twenty-five pages.
 *
 * It reads `page` rather than holding the currency in a module variable: a
 * module variable is shared by every request the server is handling at once,
 * and a settings change during one render would leak into another. `page` is
 * scoped to the request being rendered.
 *
 * Falls back to USD only when there is no operator row at all -- the sign-in
 * screen, and the first run before anybody has saved a setting.
 */
export function money(v: string | number | null | undefined): string {
	const operator = page.data.operator as { currency?: string } | null | undefined;
	return formatMoney(v, operator?.currency ?? 'USD');
}
