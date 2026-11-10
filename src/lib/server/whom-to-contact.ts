import { db } from './db/index.ts';
import { operator } from './db/schema/index.ts';
import { contactFor } from './contact.js';

/**
 * Whom a page tells someone to contact for help (#lib/server/contact): the
 * business, by the email and phone it gives under Settings → Business, or
 * their administrator where it gives neither.
 */
export async function whomToContact(): Promise<string> {
	const [business] = await db
		.select({ tradingName: operator.tradingName, email: operator.email, phone: operator.phone })
		.from(operator)
		.limit(1);
	return contactFor(business ?? {});
}
