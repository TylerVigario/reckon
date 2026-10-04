/**
 * What a release may be numbered.
 *
 * A release's version becomes its tag, the version in the package files and
 * the name of the artifact, and a published release reserves its tag for
 * ever. Nobody types it: git-cliff computes it one step past the last release,
 * as big a step as the commits say or as the operator chooses (patch, minor or
 * major). It is still checked before it is used for any of them, because it
 * is cheap to, and what it guards cannot be taken back.
 *
 *   A VERSION is MAJOR.MINOR.PATCH, each a whole number with no leading zero.
 *   One leading v is allowed and dropped, as npm drops it, so "v0.4.0" is
 *   0.4.0 and never the tag vv0.4.0. Nothing else is: no spaces, no second
 *   line, no pre-release or build suffix -- this project has never released
 *   one, and a suffix npm reads differently from git would make the tag and
 *   the package files disagree.
 *
 *   A RELEASE MAY NOT GO BACKWARDS. A number older than the one main records
 *   is refused. One step past the last release cannot be older; if one ever
 *   were, it would be found already published, read as a release whose
 *   receipt was never written, and the receipt would be written: main's
 *   version, set back.
 *
 * No dependencies, so the release workflow's first job can run it before
 * anything is installed:
 *
 *   node scripts/release-version.mjs <version> [<recorded>]
 *
 * prints the version as it is to be used, without the v, or says why not on
 * stderr and exits 1.
 */

const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The version as it is to be used -- "0.4.0" -- or throws, saying why not. */
export function releaseVersion(given) {
	const m = VERSION.exec(given);
	if (!m) {
		throw new Error(
			`${JSON.stringify(given)} is not a version number. A release is numbered like 1.2.3; a leading v is allowed.`
		);
	}
	return `${m[1]}.${m[2]}.${m[3]}`;
}

/** Negative, zero or positive as a is older than, the same as, or newer than b. */
export function compareVersions(a, b) {
	const pa = releaseVersion(a).split('.').map(BigInt);
	const pb = releaseVersion(b).split('.').map(BigInt);
	for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
	return 0;
}

/**
 * The version to release, given what main records: the same version is
 * allowed through (the workflow then has nothing to do), an older one is not.
 */
export function nextVersion(given, recorded) {
	const version = releaseVersion(given);
	if (recorded !== undefined && compareVersions(version, recorded) < 0) {
		throw new Error(`${version} is older than ${releaseVersion(recorded)}, which main records.`);
	}
	return version;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [given, recorded] = process.argv.slice(2);
	try {
		console.log(nextVersion(given ?? '', recorded));
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}
