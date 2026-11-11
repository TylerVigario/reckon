#!/usr/bin/env node
/**
 * Proves which of Better Auth's routes reckon serves (#lib/server/auth-paths),
 * against a running server whose SITE_URL is the address given.
 *
 *   node tests/auth-routes-check.mjs <base-url>
 *
 * Every closed route answers 404, by GET and by POST. The two that
 * `disabledPaths` cannot name, having a parameter, do only what
 * UNCLOSED_AUTH_PATHS says: the reset route hands nothing to another origin
 * and has no token to hand, and the social callback reports an error without
 * signing anyone in. Better Auth's answers carry the headers reckon's own do.
 *
 * It signs nobody in and leaves nothing behind.
 */
import {
	CLOSED_AUTH_PATHS,
	OPEN_AUTH_PATHS,
	UNCLOSED_AUTH_PATHS
} from '../src/lib/server/auth-paths.ts';

const [, , base] = process.argv;
if (!base) {
	console.error('usage: node tests/auth-routes-check.mjs <base-url>');
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

const ask = (/** @type {string} */ method, /** @type {string} */ path) =>
	fetch(`${base}/api/auth${path}`, {
		method,
		redirect: 'manual',
		headers: { origin: base, 'content-type': 'application/json', ...PROXY },
		body: method === 'POST' ? '{}' : undefined
	});

check(OPEN_AUTH_PATHS.length === 0, 'no route of Better Auth’s is served to the browser yet');

const closed = await Promise.all(
	CLOSED_AUTH_PATHS.flatMap((p) =>
		['GET', 'POST'].map(async (m) => [`${m} ${p}`, (await ask(m, p)).status])
	)
);
const answered = closed.filter(([, status]) => status !== 404);
check(
	answered.length === 0,
	`every closed route answers 404, by GET and by POST (${closed.length} asked)`,
	answered.map(([what, status]) => `${what} ${status}`).join(', ')
);

// The reset route: nothing for another origin, nothing to hand to this one.
const reset = Object.keys(UNCLOSED_AUTH_PATHS).find((p) => p.startsWith('/reset-password/'));
check(!!reset, 'the reset route is among those named as unclosable');
for (const elsewhere of [
	'https://evil.example/x',
	'//evil.example',
	'/\\evil.example',
	'javascript:alert(1)'
]) {
	const r = await ask(
		'GET',
		`/reset-password/anything?callbackURL=${encodeURIComponent(elsewhere)}`
	);
	check(
		r.status === 403,
		`the reset route refuses to send anyone to ${elsewhere}`,
		String(r.status)
	);
}
{
	const r = await ask('GET', '/reset-password/anything?callbackURL=%2Flink');
	const to = r.headers.get('location') ?? '';
	check(
		r.status === 302 && to === `${base}/link?error=INVALID_TOKEN`,
		'and to this origin it says only that the token is not one',
		`${r.status} ${to}`
	);
}

// The social callback: an error, and no session.
check(
	Object.keys(UNCLOSED_AUTH_PATHS).includes('/callback/:id'),
	'the social callback is among those named as unclosable'
);
for (const query of ['', '?code=x', '?code=x&state=forged']) {
	const r = await ask('GET', `/callback/google${query}`);
	const to = r.headers.get('location') ?? '';
	check(
		r.status === 302 &&
			to.startsWith(`${base}/api/auth/error?error=state_`) &&
			!(r.headers.getSetCookie?.() ?? []).some(
				(c) => c.includes('session_token=') && !c.includes('Max-Age=0')
			),
		`the social callback${query ? ` with ${query.slice(1)}` : ''} reports an error and signs nobody in`,
		`${r.status} ${to}`
	);
}
check((await ask('GET', '/error')).status === 404, 'and the error page it points to is closed');

// Its answers carry reckon's headers.
{
	const r = await ask('GET', '/get-session');
	check(
		r.headers.get('x-content-type-options') === 'nosniff' &&
			r.headers.get('x-frame-options') === 'DENY' &&
			(r.headers.get('content-security-policy') ?? '').includes('sandbox'),
		'Better Auth’s answers carry the headers reckon’s own do'
	);
}

if (failures.length) {
	console.error(`\n${failures.length} of ${passed + failures.length} failed:`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`\n${passed} checks of Better Auth’s routes passed.`);
