import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { salesTax } from '#lib/server/sales-tax.ts';
import type { PageServerLoad } from './$types';

/**
 * Each state's sales tax: what was collected there and who levied it, what
 * has been handed over and what is still held, and each period's returns and
 * payments (#lib/server/sales-tax). None where there is no state with tax to
 * say anything of.
 */
export const load: PageServerLoad = async ({ parent }) => {
	if (!(await parent()).salesTax) redirect(307, resolve('/reports/pay'));
	return { states: await salesTax() };
};
