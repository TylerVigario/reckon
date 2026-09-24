#!/usr/bin/env node
/**
 * Proves the field registries and the database agree.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/schema-check.mjs
 *
 * WHY. Validation in this app has one source of truth for two of its three
 * layers: the page and the endpoint import the same registry, so a rule cannot
 * drift between them. The DATABASE is the third, and nothing checked that it
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
import postgres from 'postgres';

const sql = process.env.DATABASE_URL
	? postgres(process.env.DATABASE_URL, { onnotice: () => {} })
	: postgres({
			host: process.env.PGHOST ?? '/var/run/postgresql',
			database: process.env.PGDATABASE ?? 'reckon_dev',
			onnotice: () => {}
		});

const { SITE_FIELDS } = await import('../src/lib/site-fields.ts');
const { CLIENT_FIELDS } = await import('../src/lib/client-fields.ts');
const { FIELDS: SETTINGS_FIELDS } = await import('../src/lib/settings-fields.ts');
const { SERVICE_FIELDS } = await import('../src/lib/service-fields.ts');

/** @type {[string, import('../src/lib/field-rules.ts').Registry][]} */
const registries = [
	['site', SITE_FIELDS],
	['entity', CLIENT_FIELDS],
	['operator', SETTINGS_FIELDS],
	['service', SERVICE_FIELDS]
];

const columns = await sql`
	select table_name, column_name, data_type, is_nullable, column_default
	  from information_schema.columns
	 where table_schema = 'public'`;

const checks = await sql`
	select conrelid::regclass::text as table_name, pg_get_constraintdef(oid) as def
	  from pg_constraint where contype = 'c'`;

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
// THE SLUG RULE, WHICH LIVES IN TWO PLACES ON PURPOSE.
//
// $lib/slug.ts runs in the browser so a form can show the URL while somebody
// types the name; slugify() runs in Postgres because the seed, the importer and
// any script insert rows without going near a form. Neither can be the only one
// that knows, and a unit test can only ever ask one of them.
//
// So the same names go to both and the answers are compared. The CHECK
// constraint would eventually catch a drift as a refused insert; this catches
// it as a failing build, naming the name that disagreed.
const { toSlug } = await import('../src/lib/slug.ts');

const NAMES = [
	'Bravo Farms',
	"Bravo's Farms, Inc.",
	'36005 CA-99 N',
	'Wild Jacks',
	'  Traver  ',
	'Shop 4',
	'A -- B',
	'...Traver!!!',
	'Kettleman City yard',
	'ACME & Sons'
];

const theirs =
	await sql`select n, slugify(n) as slug from unnest(${sql.array(NAMES)}::text[]) as n`;
looked += theirs.length;
for (const { n, slug } of theirs) {
	const mine = toSlug(n);
	if (mine !== slug) {
		complaints.push(`slug '${n}': $lib/slug says '${mine}' and the database says '${slug}'`);
	}
}

await sql.end();

console.log(`  ${looked} fields checked against the schema`);
if (complaints.length) {
	console.error(`\n${complaints.length} disagreement(s):`);
	for (const c of complaints) console.error(`  ${c}`);
	process.exit(1);
}
console.log('  the registries and the database agree');
