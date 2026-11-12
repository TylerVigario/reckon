import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';

/** The reports open on their first tab (#lib/section-tabs). */
export const load: PageServerLoad = () => redirect(307, resolve('/reports/pay'));
