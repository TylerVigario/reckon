import { tripChoices } from '#lib/server/trip-choices.ts';
import type { PageServerLoad } from './$types';

/** A trip to be written down: everything it can name, and nothing yet named. */
export const load: PageServerLoad = async ({ locals }) => tripChoices(locals.user!.id);
