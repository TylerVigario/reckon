import { error } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import { UUID } from '$lib/field-rules';
import type { PageServerLoad } from './$types';

/**
 * One invoice, and what it does to the return.
 *
 * Every figure comes off the lines as they were billed -- invoice_line stores
 * the rate that was applied and where it came from, so an invoice sent in June
 * still says what June said, whatever the rate table says today.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such invoice');

	const [invoice] = await sql<
		{
			id: string;
			number: string;
			status: string;
			who: string;
			terms: number | null;
			issued_on: string | null;
			due_on: string | null;
			sent_on: string | null;
			assembled: string;
			period_start: string | null;
			period_end: string | null;
		}[]
	>`
		select i.id, i.number, i.status, e.name as who,
		       coalesce(e.terms_days, (select default_terms_days from operator)) as terms,
		       i.issued_on::text, i.due_on::text, i.sent_at::date::text as sent_on,
		       to_char(i.created_at, 'HH24:MI') as assembled,
		       i.period_start::text, i.period_end::text
		  from invoice i join entity e on e.id = i.entity_id
		 where i.id = ${params.id}`;

	if (!invoice) error(404, 'no such invoice');

	const lines = await sql<
		{
			id: string;
			seq: number;
			kind: string;
			description: string;
			detail: string | null;
			qty: string;
			unit: string | null;
			unit_price: string;
			amount: string;
			taxable: boolean;
			tax_rate_pct: string;
			trip_leg_id: string | null;
			where_from: string | null;
		}[]
	>`
		select il.id, il.seq, il.kind, il.description,
		       -- Where the line came from, said in the terms of its source.
		       coalesce(
		         u.name || ' · ' || to_char(t.worked_on, 'FMDD Mon')
		           || coalesce(' · ' || t.note, ''),
		         to_char(tr.travelled_on, 'FMDD Mon') || ' · leg of a trip',
		         ml.supplier || ' · from stock, weighted average',
		         'Recurring · ' || to_char(ap.period_start, 'FMMonth')
		       ) as detail,
		       il.qty::text, il.unit, il.unit_price::text, il.amount::text,
		       il.taxable, il.tax_rate_pct::text, il.trip_leg_id,
		       coalesce(si.display, '') as where_from
		  from invoice_line il
		  left join time_entry t on t.id = il.time_entry_id
		  left join app_user u on u.id = t.worked_by
		  left join trip_leg tl on tl.id = il.trip_leg_id
		  left join trip tr on tr.id = tl.trip_id
		  left join material_lot ml on ml.id = il.material_lot_id
		  left join agreement_period ap on ap.id = il.agreement_period_id
		  left join site si on si.id = il.site_id
		 where il.invoice_id = ${params.id}
		 order by il.seq`;

	const [totals] = await sql<
		{
			untaxed: string;
			taxable_measure: string;
			tax: string;
			due: string;
			resold: string;
			district: string | null;
			rate_pct: string | null;
			state_rate_pct: string | null;
			district_rate_pct: string | null;
			untaxed_kinds: string[];
			taxed_kinds: string[];
		}[]
	>`
		select
		  coalesce(sum(il.amount) filter (where not il.taxable), 0)::text as untaxed,
		  coalesce(sum(il.amount) filter (where il.taxable), 0)::text     as taxable_measure,
		  coalesce(sum(il.amount * il.tax_rate_pct / 100), 0)::text       as tax,
		  coalesce(sum(il.amount + il.amount * il.tax_rate_pct / 100), 0)::text as due,
		  -- Reg 1701: tax already paid on goods that were resold comes off the
		  -- measure. The ex-tax cost is stored on the line, not recomputed.
		  coalesce(sum(il.ex_tax_cost) filter (where il.taxable), 0)::text as resold,
		  max(sr.tax_jurisdiction) as district,
		  max(il.tax_rate_pct)::text as rate_pct,
		  max(sr.state_rate_pct)::text as state_rate_pct,
		  max(sr.district_rate_pct)::text as district_rate_pct,
		  -- What is actually in each half, so the page can name them instead of
		  -- assuming labour is never taxed and goods always are.
		  array_remove(array_agg(distinct il.kind) filter (where not il.taxable), null) as untaxed_kinds,
		  array_remove(array_agg(distinct il.kind) filter (where il.taxable), null) as taxed_kinds
		  from invoice_line il
		  left join site_rate sr on sr.site_id = il.site_id
		 where il.invoice_id = ${params.id}`;

	return { invoice, lines, totals };
};
