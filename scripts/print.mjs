#!/usr/bin/env node
/**
 * Builds the printed documents with press, auditing each as it is built.
 *
 *   npm run print                                   every document under docs/
 *   npm run print -- docs/schema-reference.typ      just that one
 *   npm run print:check                             the audit, refusing without its tools
 *
 * Each document builds to print/<same path>.pdf. The documents are found as
 * press's own `all` finds them: every .typ under docs/, except that a
 * directory holding a main.typ is one document and its other files are its
 * parts, and a file whose name starts with _ is never one.
 *
 * press's tools do the work. stamp.sh builds, stamps the page with when its
 * content last changed, and audits what it built; report.sh says what was
 * made. The audit needs poppler and a Python. Without them a build says it was
 * not audited and still succeeds, which is why check exists: check.sh is the
 * same audit, and it refuses to run without them.
 *
 * The stamp is in UTC. reckon's documents are read wherever reckon is used, so
 * a page that prints its stamp says the same wherever it was built.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PRESS = 'third_party/press';
const FLAGS = ['--root', '.', '--font-path', `${PRESS}/fonts`, '--ignore-system-fonts'];
const env = { ...process.env, PRESS_TZ: 'UTC' };

/**
 * @param {string} dir
 * @param {boolean} top a main.typ directly in docs/ is a document like any other
 * @returns {string[]}
 */
function documents(dir, top) {
	const entries = readdirSync(dir, { withFileTypes: true });
	if (!top && entries.some((e) => e.isFile() && e.name === 'main.typ')) return [`${dir}/main.typ`];
	return entries.flatMap((e) => {
		const path = `${dir}/${e.name}`;
		if (e.isDirectory()) return documents(path, false);
		return e.name.endsWith('.typ') && !e.name.startsWith('_') ? [path] : [];
	});
}

const args = process.argv.slice(2);
const check = args[0] === '--check';
const named = (check ? args.slice(1) : args).map((d) => d.replace(/\\/g, '/').replace(/^\.\//, ''));
for (const doc of named)
	if (!doc.endsWith('.typ')) {
		console.error(`print: ${doc} is not a .typ file`);
		process.exit(1);
	}
const docs = named.length ? named : documents('docs', true).sort();
if (!docs.length) {
	console.error('print: no documents in docs/');
	process.exit(1);
}

let failed = 0;
// report.sh appends what each build made to the file PRESS_TALLY names, and
// counts them for the summary; "audit" is a document that failed its audit.
const work = mkdtempSync(join(tmpdir(), 'reckon-print-'));
const tally = join(work, 'tally');
writeFileSync(tally, '');
try {
	for (const doc of docs) {
		const pdf = `print/${doc.replace(/\.typ$/, '.pdf')}`;
		if (check) {
			const run = spawnSync('sh', [`${PRESS}/tools/check.sh`, doc, pdf, PRESS, ...FLAGS], {
				stdio: 'inherit',
				env
			});
			if (run.status !== 0) failed++;
			continue;
		}

		// stdout is what stamp.sh made -- new, changed or unchanged, and the
		// stamp -- and a compile that failed made nothing to report. Findings go
		// to stderr, above the line, and fail the build with the PDF written.
		const run = spawnSync('sh', [`${PRESS}/tools/stamp.sh`, doc, pdf, ...FLAGS], {
			stdio: ['inherit', 'pipe', 'inherit'],
			encoding: 'utf8',
			env
		});
		const made = run.stdout.trim();
		if (made)
			spawnSync('sh', [`${PRESS}/tools/report.sh`, pdf, ...made.split(/\s+/)], {
				stdio: 'inherit',
				env: { ...env, PRESS_TALLY: tally }
			});
		if (run.status !== 0) {
			failed++;
			if (made) appendFileSync(tally, 'audit\n');
		}
	}
	if (!check)
		spawnSync('sh', [`${PRESS}/tools/report.sh`, '--summary', tally, String(docs.length)], {
			stdio: 'inherit'
		});
} finally {
	rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
