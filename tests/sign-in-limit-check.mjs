#!/usr/bin/env node
/**
 * Proves the sign-in limit holds (#lib/server/sign-in-limit): five tries at a
 * password from one address in fifteen minutes, however many are sent at once,
 * at signing in and at changing a password alike, with an IPv6 address counted
 * as its /64 and a right password giving an address its tries back.
 *
 *   node tests/sign-in-limit-check.mjs <base-url> <full-email> <full-password>
 *
 * The server must take the visitor's address from X-Real-IP
 * (ADDRESS_HEADER=x-real-ip). Each part tries from documentation addresses of
 * its own (RFC 5737, RFC 3849), picked at random, so nothing here makes any
 * other check wait.
 *
 * Over HTTP, the way a browser does it. It changes nothing but the sessions its
 * sign-ins make.
 */

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
const signIn = (/** @type {string} */ from, /** @type {string} */ password) =>
	post('/login', from, { email: fullEmail, password, next: '/' });
/** The session cookie a response sets, or '' when it sets none. */
const sessionOf = (/** @type {Response} */ r) =>
	(r.headers.getSetCookie?.() ?? [])
		.map((c) => c.split(';')[0])
		.filter((c) => c.includes('session_token='))
		.join('; ');
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

// ---------------------------------------------------------- at once ----
{
	const from = ipv4();
	const burst = await all(20, () => signIn(from, WRONG));
	check(
		tally(burst) === '5×400 15×429',
		'twenty wrong passwords sent at once: five are checked and fifteen wait',
		tally(burst)
	);
	const right = await signIn(from, fullPassword);
	check(right.status === 429, 'then the right one waits too', String(right.status));
}

// ------------------------------------------------------------- IPv6 ----
{
	const net = ipv6Net();
	const five = await all(5, () => signIn(inNet(net), WRONG));
	check(
		tally(five) === '5×400',
		'five wrong passwords from five addresses in one /64 are checked',
		tally(five)
	);
	const sixth = await signIn(inNet(net), WRONG);
	check(sixth.status === 429, 'a sixth from another address in it waits', String(sixth.status));
	const next = await signIn(inNet(ipv6Net()), WRONG);
	check(next.status === 400, 'one from another /64 is checked', String(next.status));
}

// ---------------------------------------------------------- forgiven ----
{
	const from = inNet(ipv6Net());
	const four = await all(4, () => signIn(from, WRONG));
	const right = await signIn(from, fullPassword);
	const five = await all(5, () => signIn(from, WRONG));
	check(
		tally(four) === '4×400' && right.status === 303 && tally(five) === '5×400',
		'four wrong, then the right one, and the address has its five tries back',
		`${tally(four)}, then ${right.status}, then ${tally(five)}`
	);
}

// ---------------------------------------------- changing a password ----
{
	const from = inNet(ipv6Net());
	const cookie = sessionOf(await signIn(from, fullPassword));
	if (!cookie) {
		console.error(`  could not sign in as ${fullEmail}`);
		process.exit(1);
	}
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
	const signingIn = await signIn(from, fullPassword);
	check(
		signingIn.status === 429,
		'and signing in from there waits, the count being the same',
		String(signingIn.status)
	);
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
