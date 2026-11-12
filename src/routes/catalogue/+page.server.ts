import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';

/** The catalogue opens on its first tab (#lib/section-tabs). */
export const load: PageServerLoad = () => redirect(307, resolve('/catalogue/materials'));
