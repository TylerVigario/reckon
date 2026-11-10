import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RELEASE_FILES } from './release-files.mjs';

/** The repository, whatever directory the tests run from. */
const ROOT = path.resolve(import.meta.dirname, '..');

describe('a release', () => {
	it('names only what is here, apart from the build it makes first', () => {
		for (const p of RELEASE_FILES.filter((p) => p !== 'build'))
			assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} is not in the repository`);
	});

	it('carries everything scripts/user.mjs imports, so a host can run it', () => {
		// The release's files and nothing else, with the dependencies installed:
		// what a host has once it has unpacked one.
		const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'reckon-release-'));
		try {
			for (const p of RELEASE_FILES.filter((p) => p !== 'build'))
				fs.cpSync(path.join(ROOT, p), path.join(staged, p), { recursive: true });
			fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(staged, 'node_modules'));

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
	});
});
