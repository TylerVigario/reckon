import { currency } from './currency.ts';
import { formatMoney } from './format.ts';

/**
 * A figure in the operator's own currency.
 *
 * operator.currency is loaded by the root layout, so every screen already has
 * it without asking -- which is why this can be a plain call in the markup
 * rather than a value threaded through twenty-five pages. #lib/currency reads
 * it, so an amount is written in the currency whose places it was rounded to.
 *
 * It is read from the request being rendered -- the page's data in the browser,
 * the request in hand on the server -- rather than held in a module variable: a
 * module variable is shared by every request the server is handling at once,
 * and a settings change during one render would leak into another.
 *
 * Falls back to USD only when there is no operator row at all -- the sign-in
 * screen, and the first run before anybody has saved a setting.
 */
export function money(v: string | number | null | undefined): string {
	return formatMoney(v, currency());
}
