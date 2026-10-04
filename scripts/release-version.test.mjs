import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { compareVersions, nextVersion, releaseVersion } from './release-version.mjs';

describe('releaseVersion', () => {
	it('takes a version, with or without its v', () => {
		assert.equal(releaseVersion('0.4.0'), '0.4.0');
		assert.equal(releaseVersion('v0.4.0'), '0.4.0');
		assert.equal(releaseVersion('12.0.103'), '12.0.103');
	});

	it('refuses anything else', () => {
		for (const bad of [
			'',
			'vv0.4.0',
			'0.4',
			'0.4.0.1',
			' 0.4.0',
			'0.4.0 ',
			'0.4.0\nmode=publish',
			'0.04.0',
			'0.4.0-rc.1',
			'0.4.0+build',
			'V0.4.0',
			'latest'
		]) {
			assert.throws(() => releaseVersion(bad), /is not a version number/, JSON.stringify(bad));
		}
	});
});

describe('compareVersions', () => {
	it('compares each part as a number, not as text', () => {
		assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
		assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
		assert.ok(compareVersions('0.3.1', '0.4.0') < 0);
		assert.equal(compareVersions('v0.4.0', '0.4.0'), 0);
	});
});

describe('nextVersion', () => {
	it('lets a newer version through, and the same one', () => {
		assert.equal(nextVersion('0.4.0', '0.3.1'), '0.4.0');
		assert.equal(nextVersion('v1.0.0', '0.3.1'), '1.0.0');
		assert.equal(nextVersion('0.3.1', '0.3.1'), '0.3.1');
	});

	it('refuses to go backwards', () => {
		assert.throws(() => nextVersion('0.3.0', '0.3.1'), /0\.3\.0 is older than 0\.3\.1/);
	});
});

describe('from the command line, as the release workflow runs it', () => {
	const run = (...args) =>
		execFileSync('node', ['scripts/release-version.mjs', ...args], { encoding: 'utf8' });

	it('prints the version to use', () => {
		assert.equal(run('v0.4.0', '0.3.1'), '0.4.0\n');
	});

	it('exits 1, saying why, for anything it refuses', () => {
		assert.throws(
			() => run('vv0.4.0', '0.3.1'),
			(e) => {
				assert.equal(e.status, 1);
				assert.match(e.stderr, /"vv0\.4\.0" is not a version number/);
				assert.equal(e.stdout, '');
				return true;
			}
		);
		assert.throws(
			() => run('0.3.0', '0.3.1'),
			(e) => e.status === 1
		);
	});
});
