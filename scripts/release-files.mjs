/**
 * Not a command: what a release is made of (scripts/make-release.mjs), apart
 * from the build `vite build` makes. Its own module so a test can stage a
 * release and no more, and run what a host runs from it
 * (release-files.test.mjs).
 *
 * Everything a release runs is bundled, so it carries no node_modules: build/
 * by `vite build`, and the commands a host runs by bundleScripts, below. What
 * any of them reaches outside itself is the host's own: Node, Postgres and the
 * mail server.
 */
import path from 'node:path';

/** The repository, whatever directory this is run from. */
const ROOT = path.resolve(import.meta.dirname, '..');

/** Taken from the repository as they are, at the same paths. */
export const RELEASE_FILES = [
	'build',
	'drizzle',
	// Node reads `"type": "module"` from it to run build/; with the lockfile,
	// it says which version of each package the bundles hold.
	'package.json',
	'package-lock.json',
	'.env.example',
	'LICENSE',
	'LICENSE-NOTICE.md'
];

/**
 * The commands a host runs from a release: user.mjs, which adds the first
 * person and gives a link to make a passkey, and migrate.mjs, which brings the
 * database up to date, as its owner, before the server starts.
 */
export const RELEASE_SCRIPTS = ['user.mjs', 'migrate.mjs'];

/**
 * Each of RELEASE_SCRIPTS and everything it imports, packages and all, as one
 * file at `<release>/scripts/<name>`: the path it has here, so it is run as it
 * is here, and its `.env` is the one beside scripts/ in either. Bundled by
 * Vite, as the application is, with none of the repository's own Vite settings
 * and no .env read into it. One build each, since a bundle of several entries
 * shares chunks between them.
 *
 * @param {string} release the release's directory
 */
export async function bundleScripts(release) {
	for (const name of RELEASE_SCRIPTS) await bundleScript(release, name);
}

/**
 * @param {string} release the release's directory
 * @param {string} name the command, as scripts/ has it
 */
async function bundleScript(release, name) {
	const { build } = await import('vite');
	await build({
		configFile: false,
		envDir: false,
		root: ROOT,
		mode: 'production',
		logLevel: 'warn',
		publicDir: false,
		ssr: { noExternal: true },
		build: {
			ssr: path.join(ROOT, 'scripts', name),
			outDir: path.join(release, 'scripts'),
			emptyOutDir: false,
			target: 'esnext',
			minify: false,
			sourcemap: false,
			copyPublicDir: false,
			rolldownOptions: { output: { entryFileNames: name, codeSplitting: false } }
		}
	});
}
