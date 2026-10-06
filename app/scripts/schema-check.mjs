#!/usr/bin/env node
/**
 * Proves the field registries and the database agree.
 *
 *   node scripts/schema-check.mjs
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
 *   a choice the column forbids     oneOf offers a value the CHECK rejects
 *
 * It does NOT complain when the registry is STRICTER than the column. That is
 * the safe direction and often deliberate: `cap(120)` on a `text` column is a
 * length nobody would reach by typing, chosen here rather than in the schema.
 */
import pg from 'pg';

const pool = process.env.DATABASE_URL
	? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
	: new pg.Pool({
			host: process.env.PGHOST ?? '/var/run/postgresql',
			database: process.env.PGDATABASE ?? 'reckon_dev',
			max: 1
		});
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
const { LOT_FIELDS, NEW_MATERIAL_FIELDS } = await import('../src/lib/stock-fields.ts');
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
	['material_lot', LOT_FIELDS],
	['material', NEW_MATERIAL_FIELDS],
	['invoice_line', PASSED_ON_FIELDS],
	['invoice_line', FROM_STOCK_FIELDS],
	['user', PERSON_FIELDS]
];

const columns = await q(`
	select table_name, column_name, data_type, is_nullable, column_default
	  from information_schema.columns
	 where table_schema = 'public'`);

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

		// Every value the registry offers has to be one the column allows. The
		// list read is the one that constrains THIS column -- `field = ANY
		// (ARRAY[...])` -- not every quoted word in a check that mentions it:
		// pay_rule's amount check names the methods, and they are not amounts.
		const own = new RegExp(`\\(${field} = ANY \\(ARRAY\\[([^\\]]*)\\]`);
		const enumeration = checks
			.filter((c) => c.table_name === table)
			.map((c) => own.exec(c.def)?.[1])
			.find(Boolean);
		if (enumeration) {
			const allowed = [...enumeration.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
			for (const candidate of allowed) {
				// Anything the column allows, the registry should too -- or the
				// screen cannot offer a value the data already contains.
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
