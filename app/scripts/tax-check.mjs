#!/usr/bin/env node
/**
 * Proves the database and the valuation round tax the same way.
 *
 *   PGDATABASE=reckon_ci node scripts/tax-check.mjs
 *
 * Every tax total is rounded by its tax rule (#lib/server/tax-rules), in SQL
 * (taxSql, lineTaxSql) for balances and invoices and in TypeScript (roundTax)
 * for the valuation. Two implementations of one rule can drift by a cent, and
 * a cent is the whole difference. So the same lines go through both, for every
 * scope and method, to the places of dollars, yen and dinars (#lib/currency),
 * and any invoice that comes to two different taxes fails.
 *
 * The lines are made up, many of them, at awkward amounts and several rates,
 * from a fixed seed so a failure can be run again. They go into a temporary
 * invoice_line, which stands in front of the real one for this connection
 * alone, inside a transaction that is rolled back: nothing is written.
 */
import pg from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { Ratio } from '../src/lib/decimal.ts';
import { invoiceLine } from '../src/lib/server/db/schema/index.ts';
import { lineTaxSql, roundTax, taxSql } from '../src/lib/server/tax-rules.ts';

const pool = process.env.DATABASE_URL
	? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
	: new pg.Pool({
			host: process.env.PGHOST ?? '/var/run/postgresql',
			database: process.env.PGDATABASE ?? 'reckon_dev',
			max: 1
		});
// The casing the app's own db uses (#lib/server/db): workedOn is worked_on.
const dialect = new PgDialect({ casing: 'snake_case' });

// A small, fixed-seed generator: the same lines every run.
let seed = 20261004;
const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (/** @type {string[]} */ xs) => xs[Math.floor(next() * xs.length)];

const RATES = ['5.0000', '7.2500', '7.7500', '8.0000', '10.2500', '15.0000', '0.0000'];
/** @type {{ invoice: string; amount: string; rate: string }[]} */
const lines = [];
for (let n = 0; n < 60; n++) {
	const invoice = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
	const count = 1 + Math.floor(next() * 6);
	for (let k = 0; k < count; k++) {
		const cents = Math.floor(next() * 50000) - (next() < 0.1 ? 25000 : 0);
		const amount = `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
		lines.push({ invoice, amount, rate: pick(RATES) });
	}
}

/** @type {string[]} */
const failures = [];
const client = await pool.connect();
try {
	await client.query('begin');
	await client.query(
		`create temporary table invoice_line (invoice_id uuid, amount numeric(13,3), tax_rate_pct numeric(7,4), taxable boolean) on commit drop`
	);
	for (const l of lines)
		await client.query(
			'insert into invoice_line (invoice_id, amount, tax_rate_pct, taxable) values ($1, $2, $3, true)',
			[l.invoice, l.amount, l.rate]
		);

	for (const places of [2, 0, 3])
		for (const scope of /** @type {const} */ (['invoice', 'line']))
			for (const method of /** @type {const} */ (['half_up', 'down', 'up'])) {
				const rounding = { scope, method };
				const q = dialect.sqlToQuery(
					sql`select invoice_id, tax::text as tax from ${taxSql(rounding, places)} t`
				);
				const fromDb = new Map(
					(await client.query(q.sql, q.params)).rows.map((r) => [r.invoice_id, r.tax])
				);
				let differ = 0;
				for (const invoice of new Set(lines.map((l) => l.invoice))) {
					const mine = lines.filter((l) => l.invoice === invoice);
					const ts = roundTax(
						mine.map((l) => ({ rate: l.rate, tax: Ratio.of(l.amount).mul(l.rate).div(100) })),
						rounding,
						places
					);
					// One invoice through lineTaxSql too, the scalar form.
					const one = dialect.sqlToQuery(
						sql`select ${lineTaxSql(
							sql`${invoiceLine.amount} * ${invoiceLine.taxRatePct} / 100`,
							rounding,
							places,
							sql`from ${invoiceLine} where ${invoiceLine.invoiceId} = ${invoice}`
						)}::text as tax`
					);
					const scalar = (await client.query(one.sql, one.params)).rows[0].tax;
					const db = fromDb.get(invoice);
					if (ts === null || !ts.eq(db) || !ts.eq(scalar)) {
						differ++;
						failures.push(
							`${places} places, ${scope} ${method} ${invoice}: SQL ${db}, scalar ${scalar}, TypeScript ${ts?.toString() ?? 'nothing'}`
						);
					}
				}
				const label = `${places} places, ${scope}, ${method}: ${fromDb.size} invoices, the same tax both ways`;
				if (differ === 0) console.log(`  ✓ ${label}`);
			}
} finally {
	await client.query('rollback');
	client.release();
	await pool.end();
}

if (failures.length) {
	for (const f of failures.slice(0, 20)) console.error(`  ✗ ${f}`);
	process.exit(1);
}
console.log(`\nThe database and the valuation round tax alike, over ${lines.length} lines.`);
