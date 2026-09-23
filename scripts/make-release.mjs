/**
 * Builds the release artifact: one tarball the host extracts and runs with no
 * toolchain, no network, and no build step.
 *
 * WHY SELF-CONTAINED. The deploy target holds no runner and no build tooling.
 * If the host had to run `npm ci` it would need a path to the registry and a
 * compiler for anything native, and a deploy could then fail for reasons with
 * nothing to do with the code being deployed. Shipping node_modules inside the
 * artifact moves every one of those failures to CI, where they block a release
 * instead of breaking a running system.
 *
 * WHY THAT IS SAFE ACROSS DISTRIBUTIONS. The only native dependency is
 * @node-rs/argon2, which ships prebuilt N-API binaries per platform inside the
 * published package. What has to match is the ABI, not the distribution: any
 * glibc linux-x64 host takes the linux-x64-gnu binary assembled here, and N-API
 * keeps it valid across Node majors. Asserted below rather than assumed -- if
 * that stops being true this fails instead of shipping something that cannot
 * hash a password. A musl target would need its own build.
 *
 * WHY db/ IS IN THE TARBALL. The schema is applied on the host, by the host,
 * from the same artifact that carries the code that expects it. A migration
 * that lives only in git would have to be fetched separately, and then "which
 * schema is this version expecting" is answered by two things that can drift.
 *
 *   node scripts/make-release.mjs                  # version from package.json
 *   node scripts/make-release.mjs --version 1.2.3
 *   node scripts/make-release.mjs --out /tmp/dir --changelog /tmp/CHANGELOG.md
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : process.argv[i + 1];
};
const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts });
const die = (msg) => {
	console.error(`error: ${msg}`);
	process.exit(1);
};

// The root manifest is the version of record. app/package.json is private and
// published to nobody, so it carries 0.0.0 rather than a second number to keep
// in step.
const version = arg('version', JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
const outDir = path.resolve(arg('out', 'dist-release'));
const name = `reckon-${version}`;
const staging = path.join(outDir, name);

// A release must be traceable to a commit. A dirty tree would put changes in
// the tarball that no commit records, which makes "what is running" a question
// nobody can answer later.
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

// Rebuilt here rather than trusting whatever app/build happens to hold.
console.log('  vite build');
run('npm', ['run', 'build', '--prefix', 'app'], { stdio: 'inherit' });
fs.cpSync('app/build', path.join(staging, 'build'), { recursive: true });

// The schema, and the tooling that applies and proves it.
for (const p of ['db/migrations', 'db/test', 'db/apply.sh']) {
	fs.cpSync(p, path.join(staging, p), { recursive: true });
}
fs.chmodSync(path.join(staging, 'db/apply.sh'), 0o755);
fs.mkdirSync(path.join(staging, 'scripts'), { recursive: true });
fs.copyFileSync('app/scripts/set-password.mjs', path.join(staging, 'scripts/set-password.mjs'));

// The licence travels with the software, because this tarball IS the
// distribution. AGPL-3.0 conditions redistribution on the recipient getting the
// terms with it; a licence that only exists in a repository somebody may not
// have is not a licence they were given.
fs.copyFileSync('LICENSE', path.join(staging, 'LICENSE'));
fs.copyFileSync('LICENSE-NOTICE.md', path.join(staging, 'LICENSE-NOTICE.md'));

// And the list of what the process reads. Nothing in production loads a .env --
// the service manager supplies these -- but whoever writes that unit has to
// know what to put in it, and the artifact was the one place that did not say.
fs.copyFileSync('app/.env.example', path.join(staging, '.env.example'));

// The artifact gets its OWN minimal manifest. Copying the application's would
// list every build dependency, and `npm install` here would then resolve all of
// them — reinstating the tree this approach exists to avoid.
fs.writeFileSync(
	path.join(staging, 'package.json'),
	JSON.stringify({ name: 'reckon', version, private: true, type: 'module' }, null, 2) + '\n'
);

// adapter-node leaves `dependencies` external rather than bundling them, so
// they are exactly what has to be installed — read off the application's
// manifest, pinned to what its lockfile resolved.
const appPkg = JSON.parse(fs.readFileSync('app/package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('app/package-lock.json', 'utf8'));
const pinned = Object.keys(appPkg.dependencies ?? {}).map((dep) => {
	const entry = lock.packages?.[`node_modules/${dep}`];
	if (!entry?.version) die(`${dep} is a runtime dependency but absent from app/package-lock.json.`);
	return `${dep}@${entry.version}`;
});
console.log(`  runtime: ${pinned.join(', ') || '(none)'}`);

// --ignore-scripts: a release build does not execute package lifecycle
// scripts, and nothing here needs one. @node-rs/argon2 carries its binaries in
// the published package rather than fetching in a postinstall, and the
// assertion below fails the build if that ever changes.
if (pinned.length) {
	run('npm', ['install', ...pinned, '--ignore-scripts', '--no-audit', '--no-fund', '--no-save'], {
		cwd: staging,
		stdio: 'inherit'
	});
}

// Fail loudly rather than ship an artifact whose password hashing cannot load.
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

// The changelog ships inside the artifact: RELEASE pins which commit this is,
// the changelog says what that commit changed, and it says so without needing a
// path back to the release notes — the same reason node_modules is in here.
const changelogSrc = arg('changelog', 'CHANGELOG.md');
if (!fs.existsSync(changelogSrc))
	die(`${changelogSrc} is missing — the artifact would ship without its history.`);
fs.copyFileSync(changelogSrc, path.join(staging, 'CHANGELOG.md'));

// Identity, so a running instance traces back to a commit without guessing
// from a version number. `commit` is the commit whose SOURCE produced these
// bytes — during a release that is the parent of the tagged commit, because
// the build happens before anything is written. `git rev-parse <tag>^`
// recovers it from the other direction.
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

// Per-file manifest, so "is what is installed still what was built" is
// answerable at any time rather than only at download. An attestation covers
// the tarball's digest and says nothing about the extracted tree afterwards —
// and the extracted tree is what actually runs.
const files = [];
(function walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walk(full);
		else if (e.isFile()) files.push(full);
	}
})(staging);

const manifest = files
	.map((f) => {
		const rel = path.relative(staging, f);
		const sum = createHash('sha256').update(fs.readFileSync(f)).digest('hex');
		return `${sum}  ${rel}`;
	})
	.join('\n');
fs.writeFileSync(path.join(staging, 'MANIFEST.sha256'), manifest + '\n');

// Deterministic within a build: sorted, no owner, fixed mtime. Two builds of
// the same tree should differ only where the inputs did.
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
