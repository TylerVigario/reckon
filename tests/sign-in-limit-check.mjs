#!/usr/bin/env node
/**
 * Proves the sign-in limit holds, worked out from the record of every try at a
 * password (#lib/server/sign-in-limit).
 *
 *   node tests/sign-in-limit-check.mjs <base-url> <full-email> <full-password>
 *
 * Per address: five tries at a password in fifteen minutes, however many are
 * sent at once, at signing in and at changing a password alike, with an IPv6
 * address counted as its /64 and a right password giving an address its tries
 * back.
 *
 * Per email: ten wrong in a row from anywhere, and then each waits, the same for
 * an email nobody signs in with as for one somebody does. A browser that has
 * signed in as them is not made to wait by strangers' tries, and one that has
 * signed in only as someone else is a stranger. A right password clears the
 * count.
 *
 * At a hundred wrong in a row the right password no longer signs in, from a
 * browser that has signed in as them too, nor changes theirs, and stays so when
 * the tries that stopped it are gone; a reset on Team starts it again.
 *
 * The record: a row for every try, at an email anyone signs in with or not, and
 * none for a request a limit turns away; what was typed as the email kept
 * nowhere in it; rows deleted at 90 days.
 *
 * The server must take the visitor's address from X-Real-IP
 * (ADDRESS_HEADER=x-real-ip). Each part tries from documentation addresses of
 * its own (RFC 5737, RFC 3849), picked at random, so nothing here makes any
 * other check wait.
 *
 * Over HTTP, the way a browser does it. Needs the database the server uses, to
 * read the record, to write the tries that hours of waiting would, and to take
 * away the person it adds: it leaves nothing it made but the record's rows.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import pg from 'pg';

const [, , base, fullEmail, fullPassword] = process.argv;
if (!base || !fullEmail || !fullPassword) {
	console.error(
		'usage: node tests/sign-in-limit-check.mjs <base-url> <full-email> <full-password>'
	);
	process.exit(2);
}

// In production a TLS proxy stands in front, and the server takes the scheme
// from it. Over plain http this says what that proxy would.
/** @type {Record<string, string>} */
const PROXY = base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {};

let passed = 0;
/** @type {string[]} */
const failures = [];
const check = (/** @type {boolean} */ ok, /** @type {string} */ what, detail = '') => {
	if (ok) passed++;
	else failures.push(detail ? `${what}: ${detail}` : what);
	console.log(`  ${ok ? '✓' : '✗'} ${what}`);
};

const byte = () => crypto.getRandomValues(new Uint8Array(1))[0];
const hex = () => crypto.getRandomValues(new Uint16Array(1))[0].toString(16);
/** An address in TEST-NET-1, of the 254 that name a host. */
const ipv4 = () => {
	let host = byte();
	while (host === 0 || host === 255) host = byte();
	return `192.0.2.${host}`;
};
/** A /64 in IPv6's documentation prefix, and an address in one. */
const ipv6Net = () => `2001:db8:${hex()}:${hex()}`;
const inNet = (/** @type {string} */ net) => `${net}:${hex()}:${hex()}:${hex()}:${hex()}`;
/** An address in a /64 of its own, so its own five tries are never the limit. */
const anywhere = () => inNet(ipv6Net());
/** An email nobody signs in with. */
const nobody = () => `nobody-${crypto.randomUUID().slice(0, 8)}@kestrel.example`;
// Rows this check writes itself are from TEST-NET-2 (RFC 5737), where it never
// tries from, so they are no address's recent tries.

// A form posted as a browser posts one: without accept, SvelteKit answers as it
// does an enhanced form, in JSON, and a redirect is a 200.
const post = (
	/** @type {string} */ path,
	/** @type {string} */ from,
	/** @type {Record<string, string>} */ fields,
	cookie = ''
) =>
	fetch(base + path, {
		method: 'POST',
		redirect: 'manual',
		body: new URLSearchParams(fields),
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			accept: 'text/html',
			origin: base,
			'x-real-ip': from,
			...(cookie ? { cookie } : {}),
			...PROXY
		}
	});
const signIn = (
	/** @type {string} */ from,
	/** @type {string} */ email,
	/** @type {string} */ password,
	cookie = ''
) => post('/login', from, { email, password, next: '/' }, cookie);
/** A response's cookies as a request sends them back, those whose names match. */
const cookiesOf = (/** @type {Response} */ r, /** @type {RegExp} */ named) =>
	(r.headers.getSetCookie?.() ?? [])
		.map((c) => c.split(';')[0])
		// A cookie taken away is set empty; a value may end in '=' itself.
		.filter((c) => named.test(c.slice(0, c.indexOf('='))) && !/^[^=]*=$/.test(c))
		.join('; ');
/** The session cookie a response sets, or '' when it sets none. */
const sessionOf = (/** @type {Response} */ r) => cookiesOf(r, /session_token$/);
/** The cookie that says who has signed in on this browser (#lib/server/signed-in-here). */
const signedInHereOf = (/** @type {Response} */ r) => cookiesOf(r, /^signed_in_here$/);
/** As someone signed in, from an address of its own: an endpoint asked, in JSON. */
const asSignedIn = (
	/** @type {string} */ cookie,
	/** @type {string} */ path,
	/** @type {string} */ method,
	/** @type {unknown} */ body
) =>
	fetch(base + path, {
		method,
		redirect: 'manual',
		headers: {
			cookie,
			origin: base,
			'x-real-ip': anywhere(),
			...PROXY,
			...(body === undefined ? {} : { 'content-type': 'application/json' })
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
/** How many of each status, as "5×400 15×429". */
const tally = (/** @type {Response[]} */ rs) => {
	/** @type {Record<number, number>} */
	const n = {};
	for (const r of rs) n[r.status] = (n[r.status] ?? 0) + 1;
	return Object.entries(n)
		.map(([s, k]) => `${k}×${s}`)
		.join(' ');
};
const WRONG = 'not-the-password-at-all';
const all = (/** @type {number} */ n, /** @type {() => Promise<Response>} */ make) =>
	Promise.all(Array.from({ length: n }, make));

const db = new pg.Client(database());
await db.connect();
/** @type {string | null} */
let id = null;
/** How many rows the record holds. */
const rows = async () => Number((await db.query('select count(*) from sign_in_try')).rows[0].count);

try {
	// -------------------------------------------------------- the record ----
	{
		await db.query(
			`insert into sign_in_try (created_at, page, address, network, email_key)
			 values (now() - interval '91 days', 'sign_in', '198.51.100.1', '198.51.100.1/32', 'aged-out'),
			        (now() - interval '89 days', 'sign_in', '198.51.100.1', '198.51.100.1/32', 'not-yet')`
		);
		// What someone typing their password in the wrong box would send.
		const typed = `a-password-in-the-email-box-${hex()}${hex()}`;
		const first = await signIn(anywhere(), typed, WRONG);
		const left = await db.query(
			`select email_key from sign_in_try where email_key in ('aged-out', 'not-yet')`
		);
		check(
			first.status === 400 && left.rows.map((r) => r.email_key).join() === 'not-yet',
			'a try deletes the record’s rows older than 90 days, and no others',
			`${first.status}, ${left.rows.map((r) => r.email_key).join()}`
		);
		await db.query(`delete from sign_in_try where email_key = 'not-yet'`);
		const found = await db.query(
			`select count(*)::int as n from sign_in_try t where t::text like '%' || $1 || '%'`,
			[typed]
		);
		check(found.rows[0].n === 0, 'and what was typed as the email is kept nowhere in it');
	}

	// ------------------------------------------------- one address at once ----
	{
		const from = ipv4();
		const before = await rows();
		const burst = await all(20, () => signIn(from, nobody(), WRONG));
		check(
			tally(burst) === '5×400 15×429',
			'twenty wrong passwords sent at once from one address: five are checked and fifteen wait',
			tally(burst)
		);
		check(
			(await rows()) - before === 5,
			'and only the five are recorded, a request turned away writing nothing',
			`${(await rows()) - before} rows`
		);
		const right = await signIn(from, fullEmail, fullPassword);
		check(right.status === 429, 'then the right one waits too', String(right.status));
	}

	// ------------------------------------------------------------- IPv6 ----
	{
		const net = ipv6Net();
		const five = await all(5, () => signIn(inNet(net), nobody(), WRONG));
		check(
			tally(five) === '5×400',
			'five wrong passwords from five addresses in one /64 are checked',
			tally(five)
		);
		const sixth = await signIn(inNet(net), nobody(), WRONG);
		check(sixth.status === 429, 'a sixth from another address in it waits', String(sixth.status));
		const next = await signIn(anywhere(), nobody(), WRONG);
		check(next.status === 400, 'one from another /64 is checked', String(next.status));
	}

	// ---------------------------------------------------------- forgiven ----
	{
		const from = anywhere();
		const four = await all(4, () => signIn(from, fullEmail, WRONG));
		const right = await signIn(from, fullEmail, fullPassword);
		const five = await all(5, () => signIn(from, nobody(), WRONG));
		check(
			tally(four) === '4×400' && right.status === 303 && tally(five) === '5×400',
			'four wrong, then the right one, and the address has its five tries back',
			`${tally(four)}, then ${right.status}, then ${tally(five)}`
		);
	}

	// ---------------------------------------------- changing a password ----
	{
		const from = anywhere();
		const cookie = sessionOf(await signIn(from, fullEmail, fullPassword));
		if (!cookie) throw new Error(`could not sign in as ${fullEmail}`);
		const fields = {
			current: WRONG,
			password: 'a-new-one-never-set',
			confirm: 'a-new-one-never-set'
		};
		const burst = await all(10, () => post('/profile/password', from, fields, cookie));
		check(
			tally(burst) === '5×400 5×429',
			'ten wrong current passwords sent at once: five are checked and five wait',
			tally(burst)
		);
		const signingIn = await signIn(from, fullEmail, fullPassword);
		check(
			signingIn.status === 429,
			'and signing in from there waits, the count being the same',
			String(signingIn.status)
		);
	}

	// ------------------------------------------------ one email, anywhere ----
	const full = sessionOf(await signIn(anywhere(), fullEmail, fullPassword));
	if (!full) throw new Error(`could not sign in as ${fullEmail}`);
	const email = `limit-${crypto.randomUUID().slice(0, 8)}@kestrel.example`;
	const added = await asSignedIn(full, '/api/people', 'POST', {
		fields: { name: 'Rowan Ellery', email, role_id: '', access: 'field' }
	});
	const made = added.status === 201 ? await added.json() : null;
	id = made?.id ?? null;
	if (!id) throw new Error(`nobody was added (${added.status}), so nothing after it can be asked`);

	// Their own browser: signed in with the password handed over, and their own chosen.
	const handedIn = await signIn(anywhere(), email, made.password);
	let theirs = signedInHereOf(handedIn);
	let session = sessionOf(handedIn);
	const own = 'a-password-of-their-own';
	const chosen = await post('/new-password', anywhere(), { password: own, confirm: own }, session);
	check(
		!!theirs && !!session && chosen.status === 303,
		'someone signs in, and their browser is told it has',
		`${handedIn.status}, ${chosen.status}`
	);

	{
		// Tries that wait their turn for the lock are stamped after the ones they
		// waited for, so none reads another's as later than its own.
		const tens = [];
		for (let i = 0; i < 3; i++) {
			const at = nobody();
			tens.push(tally(await all(10, () => signIn(anywhere(), at, WRONG))));
		}
		check(
			tens.every((t) => t === '10×400'),
			'ten wrong passwords at one email sent at once are all checked, three times over',
			tens.join('; ')
		);
		const strangers = await all(20, () => signIn(anywhere(), nobody(), WRONG));
		const nobodys = nobody();
		const before = await rows();
		const atNobody = await all(20, () => signIn(anywhere(), nobodys, WRONG));
		const between = await rows();
		const atThem = await all(20, () => signIn(anywhere(), email, WRONG));
		const written = [between - before, (await rows()) - between];
		check(
			tally(strangers) === '20×400',
			'twenty wrong passwords from twenty addresses, each at an email of its own, are checked',
			tally(strangers)
		);
		check(
			tally(atNobody) === '10×400 10×429' && tally(atThem) === '10×400 10×429',
			'twenty at one email from twenty addresses: ten are checked and ten wait, whether or not anyone signs in with it',
			`${tally(atNobody)}; ${tally(atThem)}`
		);
		check(written.join() === '10,10', 'and each writes the same ten rows', written.join());
		const said = await (await signIn(anywhere(), email, WRONG)).text();
		check(said.includes('Too many tries for this email'), 'and the wait is said to be the email’s');
		const right = await signIn(anywhere(), email, own);
		check(right.status === 429, 'then the right one waits too', String(right.status));

		const someoneElse = signedInHereOf(await signIn(anywhere(), fullEmail, fullPassword));
		const elsewhere = await signIn(anywhere(), email, own, someoneElse);
		check(
			!!someoneElse && elsewhere.status === 429,
			'and from a browser that has signed in only as someone else',
			String(elsewhere.status)
		);
		const fromTheirs = await signIn(anywhere(), email, own, theirs);
		check(
			fromTheirs.status === 303,
			'but not from a browser that has signed in as them',
			String(fromTheirs.status)
		);
		theirs = signedInHereOf(fromTheirs) || theirs;
		session = sessionOf(fromTheirs) || session;
		const after = await signIn(anywhere(), email, WRONG);
		check(
			after.status === 400,
			'whose right password clears the count, so a stranger’s try is checked again',
			String(after.status)
		);
	}

	// -------------------------------------------------- a hundred in a row ----
	{
		/** Whether their password has stopped: that, and not when. */
		const stopped = async () =>
			(
				await db.query(
					'select password_stopped_at is not null as stopped from "user" where id = $1',
					[id]
				)
			).rows[0]?.stopped === true;
		const sessions = async () =>
			Number(
				(await db.query('select count(*) from session where user_id = $1', [id])).rows[0].count
			);
		// The tries hours of waiting would make, written as the record would hold
		// them, to the ninety-ninth in a row.
		const { rows: inARow } = await db.query(
			`select count(*)::int as n from sign_in_try
			  where user_id = $1 and outcome is distinct from 'right'
			    and created_at > (select max(created_at) from sign_in_try
			                       where user_id = $1 and outcome = 'right')`,
			[id]
		);
		await db.query(
			`insert into sign_in_try (page, address, network, email_key, user_id, outcome)
			 select 'sign_in', '198.51.100.1', '198.51.100.1/32', 'written-by-the-check', $1, 'wrong'
			   from generate_series(1, $2::int)`,
			[id, 99 - inARow[0].n]
		);
		const hundredth = await signIn(anywhere(), email, WRONG);
		check(
			hundredth.status === 400 && (await stopped()),
			'the hundredth wrong password in a row stops it there and then',
			`${hundredth.status}, stopped: ${await stopped()}`
		);
		const before = await sessions();
		const stranger = await signIn(anywhere(), email, own);
		const known = await signIn(anywhere(), email, own, theirs);
		check(
			stranger.status === 400 && known.status === 400 && (await sessions()) === before,
			'then the right one no longer signs in, from their own browser either, and answers as a wrong one',
			`${stranger.status}, ${known.status}, sessions ${before} then ${await sessions()}`
		);
		await db.query('delete from sign_in_try where user_id = $1', [id]);
		const aged = await signIn(anywhere(), email, own, theirs);
		check(
			aged.status === 400,
			'and still does not once the tries that stopped it are gone',
			String(aged.status)
		);
		const changing = await post(
			'/profile/password',
			anywhere(),
			{ current: own, password: 'another-of-their-own', confirm: 'another-of-their-own' },
			session
		);
		check(
			changing.status === 400 && (await changing.text()).includes('stopped working'),
			'nor does it change, signed in, which says why',
			String(changing.status)
		);

		const reset = await asSignedIn(full, `/api/people/${id}/password`, 'POST', undefined);
		const handed = reset.status === 200 ? (await reset.json()).password : '';
		const again = await signIn(anywhere(), email, handed);
		check(
			reset.status === 200 && !(await stopped()) && again.status === 303,
			'a reset on Team starts it again, and the password handed over signs in',
			`${reset.status}, stopped: ${await stopped()}, ${again.status}`
		);
	}
} finally {
	if (id) await db.query('delete from "user" where id = $1', [id]);
	await db.end();
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
