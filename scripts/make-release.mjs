/**
 * Builds the release: one tarball holding the part of this repository that
 * runs, at the same paths it has here, with its dependencies installed.
 *
 *   build/             the application, from `vite build`; `node build` runs it
 *   drizzle/           the migrations, which the application applies when it starts
 *   scripts/user.mjs   the command that adds the people who sign in
 *   package.json       and package-lock.json, as they are here
 *   node_modules/      the production dependencies, from `npm ci --omit dev`
 *   .env.example       what the environment may set
 *   LICENSE, LICENSE-NOTICE.md, CHANGELOG.md
 *   RELEASE            which commit, on what, with which Node
 *   MANIFEST.sha256    every file above, so what is installed can be checked
 *
 * THE SAME PATHS AS A CLONE. What runs from a release runs from a clone the same
 * way, so nothing has to know which of the two it is in: the server finds its
 * migrations in drizzle/ beside build/ in either.
 *
 * SELF-CONTAINED. adapter-node needs the build, package.json and the production
 * dependencies; they are installed here, from the lockfile, so a host needs
 * Node and nothing else -- no registry to reach, no compiler for anything
 * native -- and every way an install can fail fails in CI, where it stops a
 * release, rather than on the host, where it stops a deploy. The one native
 * dependency, @node-rs/argon2, ships prebuilt binaries in its package, so any
 * glibc linux-x64 host takes the one installed here; that is checked below
 * rather than assumed.
 *
 *   node scripts/make-release.mjs                  # the version in package.json
 *   node scripts/make-release.mjs --version 1.2.3
 *   node scripts/make-release.mjs --out /tmp/dir --changelog /tmp/CHANGELOG.md
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { releaseVersion } from './release-version.mjs';

/** @type {(name: string, fallback: string) => string} */
const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : process.argv[i + 1];
};
/** @type {(cmd: string, args: string[], opts?: import('node:child_process').ExecFileSyncOptions) => string} */
const run = (cmd, args, opts = {}) =>
	String(execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts }) ?? '');
/** @type {(msg: string) => never} */
const die = (msg) => {
	console.error(`error: ${msg}`);
	process.exit(1);
};

let version;
try {
	version = releaseVersion(
		arg('version', JSON.parse(fs.readFileSync('package.json', 'utf8')).version)
	);
} catch (e) {
	die(/** @type {Error} */ (e).message);
}
const outDir = path.resolve(arg('out', 'dist-release'));
const name = `reckon-${version}`;
const staging = path.join(outDir, name);

// A release is traceable to a commit: a dirty tree would put changes in it that
// no commit records, and "what is running" would have no answer.
const commit = run('git', ['rev-parse', 'HEAD']).trim();
const dirty = run('git', ['status', '--porcelain']).trim();
if (dirty && !process.argv.includes('--allow-dirty')) {
	console.error('error: the working tree is dirty — a release must be traceable to a commit.');
	console.error(dirty.split('\n').slice(0, 10).join('\n'));
	console.error('Pass --allow-dirty only when proving the machinery locally.');
	process.exit(1);
}

console.log(`building ${name} from ${commit.slice(0, 8)}${dirty ? ' (DIRTY)' : ''}`);
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// Built here, not taken from whatever build/ happens to hold.
console.log('  vite build');
run('npm', ['run', 'build'], { stdio: 'inherit' });

const take = (/** @type {string} */ p) => fs.cpSync(p, path.join(staging, p), { recursive: true });
for (const p of [
	'build',
	'drizzle',
	'scripts/user.mjs',
	'package.json',
	'package-lock.json',
	'.env.example',
	'LICENSE',
	'LICENSE-NOTICE.md'
])
	take(p);

// The production dependencies, exactly as the lockfile resolved them. No
// lifecycle script runs: nothing here needs one, and @node-rs/argon2 carries
// its binaries in the published package rather than fetching them.
console.log('  npm ci --omit dev');
run('npm', ['ci', '--omit', 'dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
	cwd: staging,
	stdio: 'inherit'
});

// An artifact whose password hashing cannot load is not shipped.
const native = path.join(staging, 'node_modules/@node-rs/argon2-linux-x64-gnu');
if (!fs.existsSync(native)) {
	const got = fs
		.readdirSync(path.join(staging, 'node_modules/@node-rs'))
		.filter((d) => d.startsWith('argon2-'));
	die(
		`the linux-x64-gnu argon2 binary is missing — the artifact could not hash a password.\n` +
			`       node_modules/@node-rs holds: ${got.join(', ') || '(nothing)'}`
	);
}

// What changed, inside the artifact, so it is known without a path back to the
// release notes.
const changelogSrc = arg('changelog', 'CHANGELOG.md');
if (!fs.existsSync(changelogSrc))
	die(`${changelogSrc} is missing — the artifact would ship without its history.`);
fs.copyFileSync(changelogSrc, path.join(staging, 'CHANGELOG.md'));

// Which commit's source made these bytes. During a release that is the parent
// of the tagged commit, since the build comes before anything is written;
// `git rev-parse <tag>^` finds it from the other side.
fs.writeFileSync(
	path.join(staging, 'RELEASE'),
	[
		`version=${version}`,
		`commit=${commit}`,
		`built_on=${os.platform()}-${os.arch()}`,
		`node=${process.version}`,
		`dirty=${dirty ? 'true' : 'false'}`,
		''
	].join('\n')
);

// Every file and its digest, so "is what is installed what was built" can be
// answered of the extracted tree at any time; an attestation covers only the
// tarball.
const files = [];
(function walk(dir) {
	for (const e of fs
		.readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walk(full);
		else if (e.isFile()) files.push(full);
	}
})(staging);
fs.writeFileSync(
	path.join(staging, 'MANIFEST.sha256'),
	files
		.map((f) => {
			const sum = createHash('sha256').update(fs.readFileSync(f)).digest('hex');
			return `${sum}  ${path.relative(staging, f)}`;
		})
		.join('\n') + '\n'
);

// Deterministic within a build: sorted, no owner, the commit's own time.
const tarball = path.join(outDir, `${name}.tar.gz`);
run('tar', [
	'--sort=name',
	'--owner=0',
	'--group=0',
	'--numeric-owner',
	`--mtime=@${run('git', ['log', '-1', '--format=%ct']).trim()}`,
	'-czf',
	tarball,
	'-C',
	outDir,
	name
]);

const digest = createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
const size = (fs.statSync(tarball).size / 1024 / 1024).toFixed(1);
console.log(`\n  ${path.relative(process.cwd(), tarball)}  ${size} MB`);
console.log(`  sha256 ${digest}`);
console.log(`  ${files.length} files`);
