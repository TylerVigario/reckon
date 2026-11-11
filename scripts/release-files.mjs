/**
 * Not a command: what a release takes from the repository, at the same paths
 * (scripts/make-release.mjs). Its own module so a test can stage these and no
 * more, and run what a host runs from them (release-files.test.mjs): a file
 * scripts/user.mjs comes to import, and nobody adds here, then fails that test
 * rather than the first `node scripts/user.mjs` on a host.
 */
export const RELEASE_FILES = [
	'build',
	'drizzle',
	'scripts/user.mjs',
	// What user.mjs reads its settings with, and connects by.
	'scripts/env.mjs',
	'src/lib/server/db/defaults.js',
	// And what it tells someone whose passkeys it ends, laid out as every
	// email is, with the business's logo measured.
	'src/lib/server/notices.js',
	'src/lib/server/email-layout.js',
	'src/lib/server/image-size.js',
	// And whom it tells them to contact.
	'src/lib/server/contact.js',
	'package.json',
	'package-lock.json',
	'.env.example',
	'LICENSE',
	'LICENSE-NOTICE.md'
];
