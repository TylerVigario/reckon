import { fail, redirect } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { clientsAndSites } from '#lib/server/choices.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { numberFrom } from '#lib/numbering.ts';
import { UUID } from '#lib/field-rules.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * A new draft for a client: nothing on it yet, and its number taken now, the
 * operator's next, so two drafts started at once cannot share one.
 */
export const load: PageServerLoad = async ({ url }) => {
	const clients = await clientsAndSites();
	const asked = url.searchParams.get('client');
	return {
		clients: clients.map((c) => ({ id: c.id, name: c.name })),
		client: asked && clients.some((c) => c.id === asked) ? asked : null
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const asked = form.get('entity_id');
		const client = typeof asked === 'string' ? asked : '';
		if (!UUID.test(client)) return fail(400, { errors: { entity_id: 'Which client.' } });

		let id: string;
		try {
			id = await asUser(locals.user!.id, async (tx) => {
				// The row held while the number is taken and moved on, so nobody
				// else takes the same one in between.
				const [op] = await tx
					.select({
						id: t.operator.id,
						format: t.operator.invoiceNumberFormat,
						next: t.operator.nextInvoiceNumber
					})
					.from(t.operator)
					.for('update');
				if (!op) throw new Error('no operator');
				const [made] = await tx
					.insert(t.invoice)
					.values({
						number: numberFrom(op.format, op.next),
						entityId: client,
						createdBy: locals.user!.id
					})
					.returning({ id: t.invoice.id });
				await tx
					.update(t.operator)
					.set({ nextInvoiceNumber: sql`${t.operator.nextInvoiceNumber} + 1` })
					.where(eq(t.operator.id, op.id));
				return made.id;
			});
		} catch (e) {
			if (e instanceof Error && e.message === 'no operator')
				return fail(400, { errors: { entity_id: 'Name the business in Settings first.' } });
			const pg = pgError(e);
			if (pg.code === '23503')
				return fail(400, { errors: { entity_id: 'That client no longer exists.' } });
			if (pg.constraint === 'invoice_number_key')
				return fail(400, {
					errors: {
						entity_id:
							'The next invoice number is already taken. Move it on in Settings → Invoicing.'
					}
				});
			throw e;
		}
		redirect(303, `/invoices/${id}`);
	}
};
