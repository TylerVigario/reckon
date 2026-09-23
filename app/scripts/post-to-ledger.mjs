#!/usr/bin/env node
/**
 * Write what happened into the beancount ledger.
 *
 *   node scripts/post-to-ledger.mjs --ledger <the operator's beancount file>
 *   node scripts/post-to-ledger.mjs --dry-run       (stdout, writes nothing)
 *
 * ON DEMAND, DELIBERATELY. Nothing calls this: not a send, not a cron. While
 * the webapp is in alpha the figures still move under you, and a ledger that
 * has been written to automatically from something still changing is a ledger
 * that has to be unpicked by hand. Run it when the books are being done.
 *
 * APPEND-ONLY AND IDEMPOTENT, which is what makes writing into somebody's
 * books survivable. Every transaction carries the reckon id it came from; the
 * ledger is read first and anything already carrying that id is skipped. So
 * running it twice adds nothing, and it can never rewrite a line that is
 * already there -- the worst it can do is add a transaction, which a diff
 * shows and git reverts.
 *
 * It does NOT commit. A ledger kept in git is best kept in a repository of its
 * own, so bookkeeping can be reverted without disturbing anything else, and
 * deciding what belongs in a commit is the bookkeeper's.
 *
 * WHOSE LEDGER. The operator's, and nobody else's. Every account name comes from
 * account_map, which belongs to the operator -- so there is no default that
 * happens to match a chart kept for some other taxpayer, and nothing this
 * writes can land in one by accident. A business that changes hands, or a
 * sole proprietor who becomes a partnership, starts a new ledger and maps it;
 * the old one is not this program's to touch.
 *
 * THREE THINGS GET POSTED, and the third is the reason this exists:
 *
 *   an invoice going out   receivable  ->  income, and the tax to whoever it is
 *                          owed to. Tax charged is not income. It is somebody
 *                          else's money held briefly, and it posts to a
 *                          liability the moment it is billed.
 *   a payment arriving     the bank  ->  receivable. Nothing about tax: the
 *                          obligation arose when the invoice was raised.
 *   a return being paid    the liability  ->  the bank. This is what closes
 *                          the loop, and without it the payable only ever
 *                          grows.
 *
 * THE TAX IS POSTED IN TWO PIECES because that is who it is owed to -- the
 * state's share and the district tax, from CDTFA's own decomposition. One
 * lumped SalesTaxPayable cannot answer what a return allocates.
 *
 * ACCOUNTS ARE OPENED IF THEY ARE MISSING. beancount refuses a posting to an
 * account with no open directive, and a ledger started fresh has none. The open
 * goes in at the date of the earliest transaction using it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import postgres from 'postgres';

/**
 * A flag's value, or what to use when it is absent. The fallback's type is
 * carried through so `arg('--from', '1900-01-01')` is a string and only
 * `arg('--ledger', null)` -- the one that genuinely may be missing -- is
 * nullable. Without that every account name would read as possibly absent.
 *
 * @template {string | null} T
 * @param {string} name
 * @param {T} fallback
 * @returns {string | T}
 */
const arg = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : fallback;
};

const from = arg('--from', '1900-01-01');
const to = arg('--to', '2999-12-31');
const ledgerPath = arg('--ledger', null);
const dry = process.argv.includes('--dry-run');

if (!ledgerPath && !dry) {
	console.error(
		'Refusing to guess where the books are.\n' +
			'  --ledger <path>   the beancount file to append to\n' +
			'  --dry-run         print the transactions instead'
	);
	process.exit(2);
}
if (ledgerPath && !existsSync(ledgerPath)) {
	console.error(`No ledger at ${ledgerPath}. Nothing was written.`);
	process.exit(2);
}

const sql = process.env.DATABASE_URL
	? postgres(process.env.DATABASE_URL, { onnotice: () => {} })
	: postgres({
			host: process.env.PGHOST ?? '/var/run/postgresql',
			database: process.env.PGDATABASE ?? 'reckon_dev',
			onnotice: () => {}
		});

/**
 * The accounts this posts to, by what each one is for. The names are the
 * operator's -- set in account_map, shown on the integrations page -- and never
 * a literal here: "Assets:AR" is a business fact like the trading name, and a
 * default would be one business's chart quietly applied to every other.
 */
const ROLES = {
	receivable: 'what clients owe',
	bank: 'where payments land, and returns are paid from',
	merchant_fees: 'what the card processor keeps',
	sales_tax_state: "sales tax collected for the state's share",
	sales_tax_district: 'sales tax collected for the districts',
	income_labour: 'labour billed',
	income_recurring: 'retainers and recurring charges',
	income_goods: 'materials sold',
	income_mileage: 'mileage charged',
	adjustments: 'credits and corrections'
};

const mapped = new Map(
	(await sql`select role, account from account_map`).map((r) => [String(r.role), String(r.account)])
);

// A role nothing reads is almost always a typo of one that is missing, so it is
// reported first -- before the refusal it usually explains. Left unreported it
// would sit on the integrations page looking configured.
for (const r of mapped.keys())
	if (!(r in ROLES)) console.error(`account_map has '${r}', which nothing posts to. A typo?`);

// Refused rather than defaulted, and every missing role named at once, so the
// operator maps them in one pass instead of meeting them one run at a time.
const missing = Object.entries(ROLES).filter(([role]) => !mapped.has(role));
if (missing.length) {
	console.error('No account is mapped for:\n');
	for (const [role, what] of missing) console.error(`  ${role.padEnd(20)} ${what}`);
	console.error(
		"\nMap each in account_map -- role, then the account in the operator's ledger:\n" +
			"  insert into account_map (role, account) values ('receivable', 'Assets:AR');\n" +
			'Nothing was written.'
	);
	await sql.end();
	process.exit(2);
}

// Only reached once every role is known to be mapped.
const accountFor = (/** @type {keyof typeof ROLES} */ role) =>
	/** @type {string} */ (mapped.get(role));

const ACCOUNTS = {
	receivable: accountFor('receivable'),
	bank: accountFor('bank'),
	fees: accountFor('merchant_fees'),
	state: accountFor('sales_tax_state'),
	district: accountFor('sales_tax_district')
};

// Income by what the line is, because a ledger that lumps labour with goods
// cannot answer the one question a sales tax return asks. Keyed by the line's
// own kind, which is what chooses between them below.
const INCOME = {
	recurring: accountFor('income_recurring'),
	material: accountFor('income_goods'),
	mileage: accountFor('income_mileage'),
	service: accountFor('income_labour'),
	adjustment: accountFor('adjustments')
};

// beancount account names take letters, digits and dashes per component.
const account = (/** @type {string} */ s) => s.replace(/[^A-Za-z0-9:-]+/g, '-').replace(/-+/g, '-');
const money = (/** @type {string | number} */ v) => `${Number(v).toFixed(2)} USD`;
const quote = (/** @type {string | number | null | undefined} */ s) =>
	`"${String(s ?? '').replace(/"/g, '\\"')}"`;
const pad = (/** @type {string} */ name) => `  ${name.padEnd(48)}`;

// What the books already have. A transaction carries the reckon id it came
// from, so "already posted" is a lookup rather than a judgement about dates
// and amounts matching.
const existing = ledgerPath ? readFileSync(ledgerPath, 'utf8') : '';
const already = new Set(
	[...existing.matchAll(/reckon-(?:invoice|payment|remittance):\s*"([0-9a-f-]{36})"/g)].map(
		(m) => m[1]
	)
);
const opened = new Set(
	[...existing.matchAll(/^\d{4}-\d{2}-\d{2}\s+open\s+(\S+)/gm)].map((m) => m[1])
);

// The latest balance assertion the ledger makes about each account. Appending
// a transaction dated BEFORE one of these changes the accumulated figure the
// assertion checks, and beancount will fail on the next run -- correctly, but
// a long way from here. Worth saying at the point of writing rather than
// leaving to be discovered.
const asserted = new Map();
for (const m of existing.matchAll(/^(\d{4}-\d{2}-\d{2})\s+balance\s+(\S+)/gm)) {
	const [, date, acct] = m;
	if (!asserted.has(acct) || date > asserted.get(acct)) asserted.set(acct, date);
}
/** @type {{ account: string; date: string; check: string }[]} */
const disturbs = [];

const out = [];
const used = new Map(); // account -> earliest date it is posted to
let skipped = 0;

/**
 * @param {string} date
 * @param {string} name
 * @param {number} amount
 */
const post = (date, name, amount) => {
	const a = account(name);
	if (!used.has(a) || date < used.get(a)) used.set(a, date);
	const check = asserted.get(a);
	if (check && date < check) disturbs.push({ account: a, date, check });
	out.push(pad(a) + money(amount));
};

// ---------------------------------------------------------------------------
// Invoices that have gone out.

const invoices = await sql`
	select i.id, i.number, i.issued_on::text, e.name as client,
	       t.tax, t.state_tax, t.district_tax,
	       t.tax_jurisdiction, t.estimated_lines,
	       (select jsonb_agg(jsonb_build_object(
	                 'kind', case when il.kind = 'service' and il.unit = 'mile'
	                              then 'mileage' else il.kind end,
	                 'amount', il.amount)
	                order by il.seq)
	          from invoice_line il where il.invoice_id = i.id) as lines
	  from invoice i
	  join entity e on e.id = i.entity_id
	  left join invoice_tax t on t.invoice_id = i.id
	 where i.status in ('sent', 'paid')
	   and i.issued_on between ${from} and ${to}
	 order by i.issued_on, i.number`;

for (const i of invoices) {
	if (already.has(i.id)) {
		skipped++;
		continue;
	}
	// One posting per kind, not per line: a ledger wants the shape of the sale,
	// and the invoice itself is where the detail lives.
	/** @type {Map<keyof typeof INCOME, number>} */
	const byKind = new Map();
	for (const l of i.lines ?? []) {
		byKind.set(l.kind, Number(byKind.get(l.kind) ?? 0) + Number(l.amount));
	}

	const gross = [...byKind.values()].reduce((n, v) => n + v, 0) + Number(i.tax ?? 0);

	out.push(`${i.issued_on} * ${quote(i.client)} ${quote(`Invoice ${i.number}`)}`);
	out.push(`  reckon-invoice: ${quote(i.id)}`);
	if (i.tax_jurisdiction) out.push(`  tax-area: ${quote(i.tax_jurisdiction)}`);
	// Said out loud rather than left to be noticed: this invoice predates the
	// first time CDTFA was asked about its site, so the shares are the earliest
	// answer on record rather than the answer of the day.
	if (Number(i.estimated_lines) > 0)
		out.push(`  tax-split-estimated: ${quote(`${i.estimated_lines} line(s)`)}`);

	post(i.issued_on, ACCOUNTS.receivable, gross);
	for (const [kind, amount] of byKind) {
		post(i.issued_on, INCOME[kind] ?? INCOME.service, -amount);
	}
	for (const [part, acct] of [
		['state_tax', ACCOUNTS.state],
		['district_tax', ACCOUNTS.district]
	]) {
		if (Number(i[part] ?? 0) !== 0) post(i.issued_on, acct, -i[part]);
	}
	out.push('');
}

// ---------------------------------------------------------------------------
// Money arriving.

const payments = await sql`
	select p.id, p.received_on::text, p.gross, p.method, e.name as client,
	       coalesce(sum(pa.amount), 0) as allocated,
	       string_agg(i.number, ', ' order by i.number) as against
	  from payment p
	  join entity e on e.id = p.entity_id
	  left join payment_allocation pa on pa.payment_id = p.id
	  left join invoice i on i.id = pa.invoice_id
	 where p.received_on between ${from} and ${to}
	 group by p.id, p.received_on, p.gross, p.method, e.name
	 order by p.received_on`;

for (const p of payments) {
	if (already.has(p.id)) {
		skipped++;
		continue;
	}
	// What the bank received against what the invoice was for: the gap is the
	// processor's cut, and it is an expense rather than a discount.
	const fee = Number(p.allocated) - Number(p.gross);
	out.push(
		`${p.received_on} * ${quote(p.client)} ` +
			quote(p.against ? `Payment for ${p.against}` : `Payment, ${p.method}`)
	);
	out.push(`  reckon-payment: ${quote(p.id)}`);
	out.push(`  method: ${quote(p.method)}`);
	post(p.received_on, ACCOUNTS.bank, p.gross);
	if (fee > 0) post(p.received_on, ACCOUNTS.fees, fee);
	post(p.received_on, ACCOUNTS.receivable, -(Number(p.gross) + fee));
	out.push('');
}

// ---------------------------------------------------------------------------
// The return being paid. Without this the payable only ever grows.

const remittances = await sql`
	select r.id, coalesce(r.paid_on, r.filed_on)::text as on_day,
	       r.period_start::text, r.period_end::text, r.amount, r.reference
	  from tax_remittance r
	 where coalesce(r.paid_on, r.filed_on) between ${from} and ${to}
	 order by coalesce(r.paid_on, r.filed_on)`;

for (const r of remittances) {
	if (already.has(r.id)) {
		skipped++;
		continue;
	}
	out.push(
		`${r.on_day} * "CDTFA" ` + quote(`Sales and use tax, ${r.period_start} to ${r.period_end}`)
	);
	out.push(`  reckon-remittance: ${quote(r.id)}`);
	if (r.reference) out.push(`  reference: ${quote(r.reference)}`);
	// Against the state's account: what a single payment settles across the
	// three obligations is the return's own allocation, and reckon does not
	// see it. Split it on the ledger side if the return breaks it out.
	post(r.on_day, ACCOUNTS.state, r.amount);
	post(r.on_day, ACCOUNTS.bank, -r.amount);
	out.push('');
}

await sql.end();

if (out.length === 0) {
	console.log(
		skipped > 0
			? `Nothing new. ${skipped} transaction(s) already in the ledger.`
			: 'Nothing in that range.'
	);
	process.exit(0);
}

// beancount refuses a posting to an account it has never seen opened, and the
// tax liabilities are new. Opened at the earliest date they are used, because
// an open dated after a posting is the same refusal.
const opens = [...used.entries()]
	.filter(([a]) => !opened.has(a))
	.sort((a, b) => (a[1] < b[1] ? -1 : 1))
	.map(([a, d]) => `${d} open ${a} USD`);

const stamp = new Date().toISOString().slice(0, 10);
const block =
	[
		'',
		`;; ---------------------------------------------------------------------`,
		`;; From reckon, ${stamp}. ${out.filter((l) => l.startsWith('2')).length} transaction(s).`,
		...(opens.length ? ['', ...opens] : []),
		'',
		...out
	].join('\n') + '\n';

// Reported before anything is written, because it is the one outcome where
// the right answer might be to not write at all.
if (disturbs.length) {
	console.error('\nThese post behind a balance assertion the ledger already makes:');
	for (const d of disturbs) {
		console.error(`  ${d.account} on ${d.date}, asserted at ${d.check}`);
	}
	console.error(
		'The assertion will fail on the next bean-check. Either the figure it\n' +
			'asserts predates these transactions and should move, or these belong\n' +
			'in an earlier period than the books are open to.\n'
	);
}

if (dry) {
	console.log(block);
	console.error(`\nDry run. ${skipped} already in the ledger, nothing written.`);
} else if (ledgerPath) {
	// ledgerPath is proven above -- not --dry-run and no --ledger exits. Said
	// again here because narrowing does not cross the two checks.
	// Append. Never rewrite: everything above this point in the file is
	// somebody's book of record, and this has no business touching it.
	writeFileSync(ledgerPath, existing + block, 'utf8');
	console.log(
		`Appended to ${ledgerPath}` +
			(opens.length ? `\n  opened ${opens.length} new account(s)` : '') +
			`\n  ${skipped} already there, skipped` +
			`\n\nNot committed. Review the diff where the ledger is kept, and commit it there.`
	);
}
