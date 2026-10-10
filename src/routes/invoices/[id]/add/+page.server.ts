import { error, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { formTerms } from '#lib/server/lines.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * Add a line: goods drawn from stock, goods bought for the job, or a cost paid
 * on the client's behalf (#lib/server/lines).
 *
 * Everything the page needs to say what a line will bill as it is typed, with
 * no signal: the client's sites and their rates, and the rest (formTerms). The
 * line itself is written on the phone and sent by the queue (#lib/queue), so
 * there is no form action.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	if (!UUID.test(params.id)) error(404, 'no such invoice');
	const [draft] = await db
		.select({
			id: t.invoice.id,
			client_uuid: t.invoice.clientUuid,
			number: t.invoice.number,
			status: t.invoice.status,
			entity_id: t.invoice.entityId,
			who: t.entity.name
		})
		.from(t.invoice)
		.innerJoin(t.entity, eq(t.entity.id, t.invoice.entityId))
		.where(eq(t.invoice.id, params.id));
	if (!draft) error(404, 'no such invoice');
	// A draft that has gone out takes no lines -- except one being fixed after
	// the server refused it, which on arrival starts a new draft for the client.
	if (draft.status !== 'draft' && !url.searchParams.has('fix'))
		redirect(303, `/invoices/${draft.id}`);
	const [sites, terms] = await Promise.all([
		db
			.select({ id: t.site.id, label: t.site.display, rate_pct: t.site.taxRatePct })
			.from(t.site)
			.where(and(eq(t.site.entityId, draft.entity_id), eq(t.site.active, true)))
			.orderBy(asc(t.site.display)),
		formTerms()
	]);
	return { draft, sites, ...terms };
};
