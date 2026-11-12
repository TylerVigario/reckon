import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleUser, RELEASE_FILES } from './release-files.mjs';

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

	it('runs scripts/user.mjs with no node_modules, everything it imports in it', async () => {
		// The release's files and nothing else: what a host has once it has
		// unpacked one. No node_modules is beside it, or above it, for anything
		// left out of the bundle to be found in.
		const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'reckon-release-'));
		try {
			for (let dir = staged; dir !== path.dirname(dir); dir = path.dirname(dir))
				assert.ok(!fs.existsSync(path.join(dir, 'node_modules')), `${dir} has a node_modules`);
			for (const p of RELEASE_FILES.filter((p) => p !== 'build'))
				fs.cpSync(path.join(ROOT, p), path.join(staged, p), { recursive: true });
			await bundleUser(staged);
			assert.deepEqual(fs.readdirSync(path.join(staged, 'scripts')), ['user.mjs']);

			// Asked nothing, it says how it is used: it loaded, every import found.
			const ran = spawnSync(process.execPath, ['scripts/user.mjs'], {
				cwd: staged,
				encoding: 'utf8'
			});
			assert.match(ran.stderr, /^usage:/, ran.stderr);
			assert.equal(ran.status, 1);
		} finally {
			fs.rmSync(staged, { recursive: true, force: true });
		}
	}, 60_000);
});
