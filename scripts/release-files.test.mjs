import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleScripts, RELEASE_FILES, RELEASE_SCRIPTS } from './release-files.mjs';

/** The repository, whatever directory the tests run from. */
const ROOT = path.resolve(import.meta.dirname, '..');

describe('a release', () => {
	it('bundles every package: package.json lists none for adapter-node to leave out', () => {
		// adapter-node bundles everything but `dependencies`, which `npm install`
		// adds to unless told --save-dev.
		const { dependencies } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
		assert.deepEqual(Object.keys(dependencies ?? {}), []);
	});

	it('names only what is here, apart from the build it makes first', () => {
		for (const p of RELEASE_FILES.filter((p) => p !== 'build'))
			assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} is not in the repository`);
	});

	it('runs its commands with no node_modules, everything each imports in it', async () => {
		// The release's files and nothing else: what a host has once it has
		// unpacked one. No node_modules is beside it, or above it, for anything
		// left out of the bundle to be found in.
		const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'reckon-release-'));
		try {
			for (let dir = staged; dir !== path.dirname(dir); dir = path.dirname(dir))
				assert.ok(!fs.existsSync(path.join(dir, 'node_modules')), `${dir} has a node_modules`);
			for (const p of RELEASE_FILES.filter((p) => p !== 'build'))
				fs.cpSync(path.join(ROOT, p), path.join(staged, p), { recursive: true });
			await bundleScripts(staged);
			assert.deepEqual(
				fs.readdirSync(path.join(staged, 'scripts')).sort(),
				[...RELEASE_SCRIPTS].sort()
			);

			// Asked nothing, user.mjs says how it is used; migrate.mjs, given no
			// database, says it needs one. Either way it loaded, every import found.
			// Nothing of the shell's reaches them, so no database is ever named.
			const run = (/** @type {string} */ name) =>
				spawnSync(process.execPath, [`scripts/${name}`], {
					cwd: staged,
					encoding: 'utf8',
					env: { PATH: process.env.PATH }
				});
			const user = run('user.mjs');
			assert.match(user.stderr, /^usage:/, user.stderr);
			assert.equal(user.status, 1);
			const migrate = run('migrate.mjs');
			assert.match(migrate.stderr, /PGDATABASE must be set/, migrate.stderr);
			assert.notEqual(migrate.status, 0);
		} finally {
			fs.rmSync(staged, { recursive: true, force: true });
		}
	}, 60_000);
});
