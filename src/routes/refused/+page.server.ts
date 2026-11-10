import { whomToContact } from '#lib/server/whom-to-contact.ts';
import type { PageServerLoad } from './$types';

/** Whom to contact to have their access changed (#lib/server/contact). */
export const load: PageServerLoad = async () => ({ contact: await whomToContact() });
