#!/usr/bin/env node
/**
 * A stand-in for Have I Been Pwned's Pwned Passwords, for the checks to run
 * against without the network: the range API as it answers, from a breach of
 * its own (BREACHED), so a check knows a password it will call breached.
 *
 *   node tests/pwned-stand-in.mjs [port]     # 5180 unless given
 *
 * The server is pointed at it with PWNED_PASSWORDS_URL=http://127.0.0.1:5180/range/,
 * as is scripts/user.mjs. Every range is answered as the real one answers a
 * padded request: the hashes under it that were breached, as the 35 characters
 * after the prefix and a count, among made-up ones that count 0. One password,
 * CANNOT_SAY, is answered with an error, as a service that is down answers.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

/** What this breach holds, each long enough and uncommon enough for nothing else to refuse it. */
export const BREACHED = ['seen-in-a-breach-elsewhere', 'leaked-along-with-the-rest'];

/** A password Pwned Passwords cannot be asked about: the common list decides alone. */
export const CANNOT_SAY = 'asked-when-the-service-was-down';

const sha1 = (/** @type {string} */ p) =>
	createHash('sha1').update(p, 'utf8').digest('hex').toUpperCase();

if (import.meta.main) {
	const port = Number(process.argv[2] ?? 5180);
	const silent = sha1(CANNOT_SAY).slice(0, 5);
	createServer((req, res) => {
		const prefix = /^\/range\/([0-9A-F]{5})$/.exec(req.url ?? '')?.[1];
		if (!prefix) return res.writeHead(404).end();
		if (prefix === silent) return res.writeHead(503).end();
		const lines = BREACHED.map(sha1)
			.filter((h) => h.startsWith(prefix))
			.map((h) => `${h.slice(5)}:${1000}`);
		// Padding, which counts 0 and is no match.
		for (let i = 0; i < 8; i++)
			lines.push(
				`${createHash('sha1').update(`${prefix}${i}`).digest('hex').slice(5).toUpperCase()}:0`
			);
		res.writeHead(200, { 'content-type': 'text/plain' }).end(lines.join('\r\n'));
	}).listen(port, '127.0.0.1', () => console.log(`  Pwned Passwords stand-in on ${port}`));
}
