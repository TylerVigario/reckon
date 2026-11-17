import { db } from './db/index.ts';
import { contactFor } from './contact.js';

/**
 * Whom a page tells someone to contact for help (#lib/server/contact): the
 * business, by the email and phone it gives under Settings → Business, or
 * their administrator where it gives neither.
 */
export async function whomToContact(): Promise<string> {
	const business = await db
		.selectFrom('operator')
		.select(['trading_name as tradingName', 'email', 'phone'])
		.limit(1)
		.executeTakeFirst();
	return contactFor(business ?? {});
}
