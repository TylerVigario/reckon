#!/usr/bin/env node
/**
 * Proves the migrations are the schema. The schema is TypeScript and drizzle/
 * is generated from it, so a change to one without the other is an app
 * expecting columns no database has, found at runtime. drizzle-kit generates
 * from the schema here as `npm run db:generate` would, and must find nothing to
 * write.
 *
 *   npm run db:drift
 *
 * It writes into a copy of drizzle/, so a run that finds a change leaves the
 * working tree as it was: the migration is still to be generated, and named,
 * with db:generate. drizzle-kit takes a config or flags, never both, so the copy
 * is named by a config that is drizzle.config.ts with `out` changed, and
 * relative, since an absolute `out` is read as one under the working directory.
 * Its stdin is closed, so a question it would ask fails rather than waits.
 *
 * Passing needs drizzle-kit to say there is nothing to migrate. It exits 0 when
 * it cannot read the copy, having written nothing, and that is not a pass.
 * Nothing here connects to a database.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import config from '../drizzle.config.ts';

// drizzle-kit's own default, should the config ever stop naming it.
const source = config.out ?? 'drizzle';
const scratch = mkdtempSync(join(tmpdir(), 'reckon-drift-'));
let failed = false;
try {
	const out = join(scratch, 'drizzle');
	cpSync(source, out, { recursive: true });
	const before = new Set(readdirSync(out, { recursive: true, encoding: 'utf8' }));

	const copied = join(scratch, 'drizzle.config.ts');
	writeFileSync(
		copied,
		`import base from ${JSON.stringify(resolve('drizzle.config.ts'))};\n` +
			`export default { ...base, out: ${JSON.stringify(relative(process.cwd(), out))} };\n`
	);

	const run = spawnSync(
		'npx',
		['--no-install', 'drizzle-kit', 'generate', '--config', copied, '--name', 'drift'],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
	);
	if (run.error) throw run.error;
	process.stdout.write(run.stdout);
	process.stderr.write(run.stderr);

	const written = readdirSync(out, { recursive: true, encoding: 'utf8' }).filter(
		(f) => !before.has(f)
	);
	if (written.length) {
		console.error('\nThe schema changed without a migration. drizzle-kit would write:');
		for (const f of written) console.error(`  ${join(source, f)}`);
		console.error('Generate it: npm run db:generate -- --name what-changed');
		failed = true;
	} else if (run.status !== 0 || !run.stdout.includes('No schema changes')) {
		console.error(`\ndrizzle-kit did not say the schema is unchanged. Exit ${run.status}.`);
		failed = true;
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
if (failed) process.exit(1);
