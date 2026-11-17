#!/usr/bin/env node
/**
 * Proves the field registries and the database agree.
 *
 *   node tests/schema-check.mjs
 *
 * WHY. Validation in this app has one source of truth for two of its three
 * layers: the page and the endpoint import the same registry, so a rule cannot
 * drift between them. The DATABASE is the third, and this checks that it
 * agrees. When it does not, the endpoint falls through to
 * refuseIfTheDatabaseSaidSo and the person is told "The database refused that
 * value" -- which is the app admitting it does not know its own rules.
 *
 * So this reads the same registry objects the app does -- not a copy, not a
 * parse of the source -- and asks the database what it actually enforces.
 *
 * WHAT IT REFUSES TO ACCEPT:
 *
 *   a field naming no column        the request would be allowed and then fail
 *   a NOT NULL column accepting ''  the registry says optional, the column
 *                                   does not; the refusal comes from Postgres
 *                                   with a constraint name in it
 *   a word the registry refuses     the column's type has it, so the data can,
 *                                   and the screen could not offer it
 *
 * It does NOT complain when the registry is STRICTER than the column. That is
 * the safe direction and often deliberate: `cap(120)` on a `text` column is a
 * length nobody would reach by typing, chosen here rather than in the schema.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import pg from 'pg';

const pool = new pg.Pool({ ...database(), max: 1 });
const q = (/** @type {string} */ text, /** @type {unknown[]} */ values = []) =>
	pool.query(text, values).then((r) => r.rows);

const { SITE_FIELDS } = await import('../src/lib/site-fields.ts');
const { CLIENT_FIELDS } = await import('../src/lib/client-fields.ts');
const { FIELDS: SETTINGS_FIELDS } = await import('../src/lib/settings-fields.ts');
const { SERVICE_FIELDS, PRICE_FIELDS, RULE_FIELDS } = await import('../src/lib/service-fields.ts');
const { AGREEMENT_FIELDS, NEW_AGREEMENT_FIELDS, COVERAGE_FIELDS } =
	await import('../src/lib/agreement-fields.ts');
const { ROLE_FIELDS, PERSON_FIELDS } = await import('../src/lib/people-fields.ts');
const { UNIT_FIELDS } = await import('../src/lib/unit-fields.ts');
const { RECEIPT_FIELDS, NEW_MATERIAL_FIELDS } = await import('../src/lib/stock-fields.ts');
const { ADJUST_FIELDS } = await import('../src/lib/adjust-fields.ts');
const { MATERIAL_FIELDS } = await import('../src/lib/material-fields.ts');
const { COUNT_LINE_FIELDS } = await import('../src/lib/count-fields.ts');
const { PASSED_ON_FIELDS, FROM_STOCK_FIELDS } = await import('../src/lib/line-fields.ts');

/** @type {[string, import('../src/lib/field-rules.ts').Registry][]} */
const registries = [
	['site', SITE_FIELDS],
	['entity', CLIENT_FIELDS],
	['operator', SETTINGS_FIELDS],
	['service', SERVICE_FIELDS],
	['service_price', PRICE_FIELDS],
	['pay_rule', RULE_FIELDS],
	['agreement', AGREEMENT_FIELDS],
	['agreement', NEW_AGREEMENT_FIELDS],
	['agreement_service', COVERAGE_FIELDS],
	['role', ROLE_FIELDS],
	['unit', UNIT_FIELDS],
	['stock_receipt', RECEIPT_FIELDS],
	['stock_adjustment', ADJUST_FIELDS],
	['material', NEW_MATERIAL_FIELDS],
	['material', MATERIAL_FIELDS],
	['stock_count_line', COUNT_LINE_FIELDS],
	['invoice_line', PASSED_ON_FIELDS],
	['invoice_line', FROM_STOCK_FIELDS],
	['user', PERSON_FIELDS]
];

const columns = await q(`
	select table_name, column_name, data_type, udt_name, is_nullable, column_default
	  from information_schema.columns
	 where table_schema = 'public'`);

// The words of each of the schema's types, in their order.
const words = new Map(
	(
		await q(`
		select t.typname as type, array_agg(e.enumlabel order by e.enumsortorder) as words
		  from pg_enum e join pg_type t on t.oid = e.enumtypid
		 group by t.typname`)
	).map((r) => [r.type, r.words])
);

// regclass names "user" with its quotes, because user is a keyword; relname
// is the table's plain name, as the registries have it.
const checks = await q(`
	select t.relname as table_name, pg_get_constraintdef(c.oid) as def, c.conname as name
	  from pg_constraint c join pg_class t on t.oid = c.conrelid
	 where c.contype = 'c'`);

const complaints = [];
let looked = 0;

for (const [table, registry] of registries) {
	for (const [field, parse] of Object.entries(registry)) {
		looked++;
		const column = columns.find((c) => c.table_name === table && c.column_name === field);

		if (!column) {
			complaints.push(
				`${table}.${field}: the registry has this field and the table has no such column`
			);
			continue;
		}

		// What the parser does with an empty string tells us whether it treats
		// the field as optional -- asked of the rule itself rather than
		// inferred from how it was written.
		const empty = parse('');
		const acceptsEmpty = empty.ok && (empty.value === null || empty.value === '');
		const required = column.is_nullable === 'NO' && column.column_default === null;

		if (acceptsEmpty && required) {
			complaints.push(
				`${table}.${field}: the registry accepts an empty value, the column is NOT NULL with no default`
			);
		}

		// Every word the column's type has, the registry has to accept too -- or
		// the screen cannot offer a value the data already contains.
		if (column.data_type === 'USER-DEFINED') {
			for (const candidate of words.get(column.udt_name) ?? []) {
				if (!parse(candidate).ok) {
					complaints.push(
						`${table}.${field}: the column allows '${candidate}' and the registry refuses it`
					);
				}
			}
		}
	}
}

// ===========================================================================
// THE SLUG RULE, WHICH THE DATABASE ENFORCES AND #lib/slug MAKES.
//
// toSlug runs in the browser, so a form can show the URL while somebody types
// the name, and on the server when a site or a service is saved without one.
// The database refuses anything that is not a slug, by a CHECK. A unit test
// can only ask one of them, so the same names go through toSlug and then to
// each CHECK's own pattern: a slug the database would refuse fails the build
// here, naming the name, rather than a save later.
const { toSlug } = await import('../src/lib/slug.ts');

const NAMES = [
	'Harbor Light Dental',
	"Harbor Light's Dental, Inc.",
	'8556 Gibson Ranch Park Rd',
	'Valley Oak Veterinary',
	'  Woodland  ',
	'Suite 210',
	'A -- B',
	'...Woodland!!!',
	'Auburn annex',
	'ACME & Sons'
];

const slugChecks = checks.filter((c) => c.name.endsWith('_slug_is_a_slug'));
if (slugChecks.length < 2)
	complaints.push(`slug: expected the entity and site slug CHECKs, found ${slugChecks.length}`);
for (const c of slugChecks) {
	const pattern = /~ '((?:[^']|'')*)'::text/.exec(c.def)?.[1]?.replaceAll("''", "'");
	if (!pattern) {
		complaints.push(`slug: ${c.name} is not a pattern this can read: ${c.def}`);
		continue;
	}
	for (const n of NAMES) {
		looked++;
		const mine = toSlug(n);
		const [{ ok }] = await q('select $1::text ~ $2::text as ok', [mine, pattern]);
		if (!ok) complaints.push(`slug '${n}': #lib/slug makes '${mine}', which ${c.name} refuses`);
	}
}

await pool.end();

console.log(`  ${looked} fields checked against the schema`);
if (complaints.length) {
	console.error(`\n${complaints.length} disagreement(s):`);
	for (const c of complaints) console.error(`  ${c}`);
	process.exit(1);
}
console.log('  the registries and the database agree');
