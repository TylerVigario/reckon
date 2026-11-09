import { fail } from '@sveltejs/kit';
import { and, asc, desc, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { accountMap, emailMessage, integration } from '#lib/server/db/schema/index.ts';
import { mailer, sendTest } from '#lib/server/email.ts';
import type { Actions, PageServerLoad } from './$types';

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
		{ name: 'email', title: 'Email', sub: 'Notices to the people who sign in' }
	];

	const [rows, mapping, [failing]] = await Promise.all([
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
			.orderBy(asc(accountMap.role)),
		// The latest message the relay would not take: still waiting, or given up on.
		db
			.select({
				said: emailMessage.lastError,
				at: sql<string>`coalesce(${emailMessage.gaveUpAt}, ${emailMessage.createdAt})::text`,
				waiting: sql<boolean>`${emailMessage.gaveUpAt} is null`
			})
			.from(emailMessage)
			.where(and(isNull(emailMessage.sentAt), isNotNull(emailMessage.lastError)))
			.orderBy(desc(emailMessage.createdAt))
			.limit(1)
	]);

	// Email is connected when the environment says where it goes
	// (#lib/server/email), whatever the table last recorded.
	const relay = mailer();
	return {
		integrations: KNOWN.map((k) => {
			const row = rows.find((r) => r.name === k.name);
			return k.name === 'email'
				? { ...k, ...row, connected: relay !== null, detail: relay ? `as ${relay.from}` : null }
				: { ...k, ...row };
		}),
		emailFailing: relay ? (failing ?? null) : null,
		mapping
	};
};

export const actions: Actions = {
	/** A test of email, sent now to whoever asked, with what the relay said. */
	test: async ({ locals }) => {
		const tested = await sendTest(locals.user!);
		return tested.sent ? { tested } : fail(502, { tested });
	}
};
