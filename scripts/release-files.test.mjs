import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleCommand, RELEASE_COMMAND, RELEASE_FILES } from './release-files.mjs';

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

	it('runs its command with no node_modules, everything it imports in it', async () => {
		// The release's files and nothing else: what a host has once it has
		// unpacked one. No node_modules is beside it, or above it, for anything
		// left out of the bundle to be found in.
		const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'reckon-release-'));
		try {
			for (let dir = staged; dir !== path.dirname(dir); dir = path.dirname(dir))
				assert.ok(!fs.existsSync(path.join(dir, 'node_modules')), `${dir} has a node_modules`);
			for (const p of RELEASE_FILES.filter((p) => p !== 'build'))
				fs.cpSync(path.join(ROOT, p), path.join(staged, p), { recursive: true });
			await bundleCommand(staged);
			assert.deepEqual(fs.readdirSync(path.join(staged, path.dirname(RELEASE_COMMAND))), [
				path.basename(RELEASE_COMMAND)
			]);

			// Run as a host runs it, by its path, which its first line and its
			// mode make a program. Nothing of the shell's reaches it, so no
			// database is ever named.
			const run = (/** @type {string[]} */ ...args) =>
				spawnSync(RELEASE_COMMAND, args, {
					cwd: staged,
					encoding: 'utf8',
					env: { PATH: process.env.PATH }
				});
			const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
			const which = run('--version');
			assert.equal(which.stdout, `reckon ${version}\n`, which.stderr);
			assert.equal(which.status, 0);
			// --help names every command, each of which loaded with it, every
			// import found.
			const help = run('--help');
			assert.match(help.stdout, /^usage: bin\/reckon <command>/, help.stderr);
			for (const name of ['migrate', 'user', 'tax'])
				assert.match(help.stdout, new RegExp(`^  ${name} `, 'm'), help.stdout);
			assert.equal(help.status, 0);
			// Reaching for the database, it says it needs one.
			for (const args of [['migrate'], ['user', 'list'], ['tax', 'refresh', '--dry-run']]) {
				const ran = run(...args);
				assert.match(ran.stderr, /PGDATABASE must be set/, `${args.join(' ')}: ${ran.stderr}`);
				assert.equal(ran.status, 2);
			}
		} finally {
			fs.rmSync(staged, { recursive: true, force: true });
		}
	}, 60_000);
});
