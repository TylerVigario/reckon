#!/usr/bin/env node
/**
 * Reads back everything the server wrote while the checks ran, and holds it to
 * what the README's "Logging" says of it: one JSON record a line, each with its
 * time in UTC and its level; a start and a stop recorded; no secret or session
 * cookie in any line; and no error nobody meant -- every request the checks
 * make is answered on purpose, so one with an `error.id` is a fault.
 *
 *   node tests/log-check.mjs /tmp/reckon.log
 *
 * The one line that is not JSON is adapter-node's own "Listening on", which
 * reckon does not write.
 */
import { readFileSync } from 'node:fs';

const [, , file] = process.argv;
if (!file) {
	console.error('usage: log-check.mjs <the server output>');
	process.exit(2);
}

const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
/** @type {Record<string, unknown>[]} */
const records = [];
/** @type {string[]} */
const failures = [];
const fail = (/** @type {string} */ why) => failures.push(why);

for (const line of lines) {
	if (/^Listening on /.test(line)) continue;
	try {
		records.push(JSON.parse(line));
	} catch {
		fail(`not a JSON record: ${line.slice(0, 200)}`);
	}
}

for (const r of records) {
	if (typeof r.time !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.time))
		fail(`no time in UTC: ${JSON.stringify(r).slice(0, 200)}`);
	if (typeof r.level !== 'string') fail(`no level by name: ${JSON.stringify(r).slice(0, 200)}`);
}

if (!records.some((r) => r.event === 'sys_startup')) fail('no sys_startup recorded');
if (!records.some((r) => r.event === 'sys_shutdown' && r.reason))
	fail('no sys_shutdown recorded, with why');

for (const r of records.filter((r) => r['error.id']))
	fail(`an error nobody meant: ${JSON.stringify(r).slice(0, 400)}`);

// What must never be written: the session cookie Better Auth sets, and the
// secret that signs it.
const secret = process.env.BETTER_AUTH_SECRET;
for (const line of lines) {
	if (/reckon\.session_token=|session_token":"[^"[]/.test(line))
		fail(`a session cookie: ${line.slice(0, 200)}`);
	if (secret && line.includes(secret)) fail('the session secret');
}

if (failures.length) {
	for (const f of failures) console.log(`  ✗ ${f}`);
	console.log(`\n${failures.length} of what the log should be, not.`);
	process.exit(1);
}
console.log(
	`${records.length} records, each one JSON line with its time and level; started and stopped; nothing kept out was written.`
);
