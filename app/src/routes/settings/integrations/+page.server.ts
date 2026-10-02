import { asc, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { accountMap, integration } from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/** What is wired up, and what it points at. Never a credential. */
export const load: PageServerLoad = async () => {
	const KNOWN = [
		{ name: 'stripe', title: 'Stripe', sub: 'Card payments · fees posted to the ledger' },
		{
			name: 'beancount',
			title: 'beancount',
			sub: 'Invoices, payments and fees post as transactions'
		},
		{ name: 'press', title: 'press', sub: 'Typst · renders the invoice that is attached' },
		{ name: 'email', title: 'Email', sub: 'How an invoice reaches a client' }
	];

	const [rows, mapping] = await Promise.all([
		db
			.select({
				name: integration.name,
				connected: integration.connected,
				detail: integration.detail,
				checked_at: sql<string | null>`${integration.checkedAt}::text`
			})
			.from(integration),
		db
			.select({ role: accountMap.role, account: accountMap.account })
			.from(accountMap)
			.orderBy(asc(accountMap.role))
	]);

	return {
		integrations: KNOWN.map((k) => ({ ...k, ...(rows.find((r) => r.name === k.name) ?? {}) })),
		mapping
	};
};
