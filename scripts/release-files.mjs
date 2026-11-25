/**
 * Not a command: what a release is made of (scripts/make-release.mjs), apart
 * from the build `vite build` makes. Its own module so a test can stage a
 * release and no more, and run what a host runs from it
 * (release-files.test.mjs).
 *
 * Everything a release runs is bundled, so it carries no node_modules: build/
 * by `vite build`, and the command a host runs by bundleCommand, below. What
 * any of them reaches outside itself is the host's own: Node, Postgres and the
 * mail server.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The repository, whatever directory this is run from. */
const ROOT = path.resolve(import.meta.dirname, '..');

/** Taken from the repository as they are, at the same paths. */
export const RELEASE_FILES = [
	'build',
	// Node reads `"type": "module"` from it to run build/; with the lockfile,
	// it says which version of each package the bundles hold.
	'package.json',
	'package-lock.json',
	'.env.example',
	'LICENSE',
	'LICENSE-NOTICE.md'
];

/**
 * The command a host runs from a release, at the path it has here: bin/reckon,
 * which brings the database up to date as its owner before the server starts,
 * adds the first person and gives a link to make a passkey, and keeps the tax
 * rates in sync (src/cli).
 */
export const RELEASE_COMMAND = 'bin/reckon';

/**
 * RELEASE_COMMAND and everything it imports, packages and all, as one file at
 * `<release>/bin/reckon`: the path it has here, so it is run as it is here,
 * and its `.env` is the one beside bin/ in either. Bundled by Vite, as the
 * application is, with none of the repository's own Vite settings and no .env
 * read into it, its first line kept so it runs as a program, and executable.
 *
 * @param {string} release the release's directory
 */
export async function bundleCommand(release) {
	const { build } = await import('vite');
	const [dir, name] = [path.dirname(RELEASE_COMMAND), path.basename(RELEASE_COMMAND)];
	await build({
		configFile: false,
		envDir: false,
		root: ROOT,
		mode: 'production',
		logLevel: 'warn',
		publicDir: false,
		ssr: { noExternal: true },
		build: {
			ssr: path.join(ROOT, RELEASE_COMMAND),
			outDir: path.join(release, dir),
			emptyOutDir: false,
			target: 'esnext',
			minify: false,
			sourcemap: false,
			copyPublicDir: false,
			rolldownOptions: { output: { entryFileNames: name, codeSplitting: false } }
		}
	});
	fs.chmodSync(path.join(release, RELEASE_COMMAND), 0o755);
}
