import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Materials: cost and tax stored apart.
 *
 * A lot records what was paid excluding tax, and the tax paid on it, as two
 * figures. Reg 1701 lets the tax already paid on goods that were resold come
 * off the measure -- which is only possible if the two were never added
 * together. Price is the ex-tax cost plus markup, weighted across open lots.
 */
export const load: PageServerLoad = async () => {
	const materials = await sql<
		{
			id: string;
			name: string;
			sku: string | null;
			brand: string | null;
			unit: string;
			markup_pct: string | null;
			on_hand: string;
			ex_tax: string | null;
			tax_paid: string | null;
			price: string | null;
			suppliers: string | null;
		}[]
	>`
		select m.id, m.name, m.sku, m.brand, m.unit,
		       coalesce(m.markup_pct, (select default_markup_pct from operator))::text as markup_pct,
		       coalesce(sum(ml.qty_remaining), 0)::text as on_hand,
		       -- Weighted across what is still on the shelf: two spools bought at
		       -- different prices are one price to sell from.
		       (sum(ml.ex_tax_cost_per_unit * ml.qty_remaining)
		        / nullif(sum(ml.qty_remaining), 0))::text as ex_tax,
		       (sum(ml.tax_paid_per_unit * ml.qty_remaining)
		        / nullif(sum(ml.qty_remaining), 0))::text as tax_paid,
		       coalesce(
		         (select mp.price from material_price mp
		           where mp.material_id = m.id and mp.effective_from <= current_date
		           order by mp.effective_from desc limit 1),
		         round(sum(ml.ex_tax_cost_per_unit * ml.qty_remaining)
		               / nullif(sum(ml.qty_remaining), 0)
		               * (1 + coalesce(m.markup_pct,
		                               (select default_markup_pct from operator)) / 100), 2)
		       )::text as price,
		       string_agg(distinct ml.supplier, ', ') as suppliers
		  from material m
		  left join material_lot ml on ml.material_id = m.id and ml.qty_remaining > 0
		 where m.active
		 group by m.id, m.name, m.sku, m.brand, m.unit, m.markup_pct
		 order by m.name`;

	const [op] = await sql<{ markup: string }[]>`
		select default_markup_pct::text as markup from operator`;

	return { materials, markup: op?.markup ?? null };
};
