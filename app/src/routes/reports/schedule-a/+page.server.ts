import { error } from '@sveltejs/kit';
import { fiscalYear } from '$lib/server/periods';
import { scheduleA, taxObligation } from '$lib/server/reports';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const fy = await fiscalYear();
	if (!fy) error(409, 'The month the filing year ends in has not been set.');
	const [a, owed] = await Promise.all([scheduleA(fy), taxObligation(fy)]);
	return { fy, ...a, owed };
};
