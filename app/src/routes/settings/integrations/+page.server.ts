import { sql } from '$lib/server/db';
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

	const rows = await sql<
		{ name: string; connected: boolean; detail: string | null; checked_at: string | null }[]
	>`select name, connected, detail, checked_at::text from integration`;

	const mapping = await sql<{ role: string; account: string }[]>`
		select role, account from account_map order by role`;

	return {
		integrations: KNOWN.map((k) => ({ ...k, ...(rows.find((r) => r.name === k.name) ?? {}) })),
		mapping
	};
};
