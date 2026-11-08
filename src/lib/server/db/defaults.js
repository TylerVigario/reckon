// Where the database is when nothing says otherwise, and which one it is, which
// nothing assumes. Plain JavaScript, so the server, the commands in scripts/ and
// the checks in tests/ share one answer, and a release can run scripts/user.mjs
// with nothing of src/ but this.

/**
 * PGHOST when it is unset: where libpq itself looks on this platform.
 *
 * - Linux: the unix socket Debian, Ubuntu and Fedora packages make. Connecting
 *   there signs in as the process's own system user, with no password.
 * - macOS: /tmp, where Homebrew's and Postgres.app's servers put theirs.
 * - Windows: no unix socket. The installer's server listens on localhost:5432,
 *   and the password comes from PGPASSWORD or libpq's password file.
 */
export const DEFAULT_PGHOST =
	process.platform === 'win32'
		? 'localhost'
		: process.platform === 'darwin'
			? '/tmp'
			: '/var/run/postgresql';

/**
 * Why the server or a command stops where neither DATABASE_URL nor PGDATABASE is
 * set: which database is the business's is said, never assumed, in development
 * too.
 */
export const NO_DATABASE =
	'PGDATABASE must be set, or DATABASE_URL: the database reckon keeps the business in. ' +
	'In development, .env names it (.env.example), as PGDATABASE=reckon_dev.';

/**
 * How to reach the database these settings name, the one rule the server and
 * every command connect by: DATABASE_URL outright, or PGDATABASE at PGHOST, as
 * PGUSER, PGPASSWORD and PGPORT say. Undefined where neither is named, which
 * NO_DATABASE says why.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {import('pg').ClientConfig | undefined}
 */
export function connectionFrom(env) {
	const url = env.DATABASE_URL?.trim();
	if (url) return { connectionString: url };
	const database = env.PGDATABASE?.trim();
	if (!database) return undefined;
	return {
		host: env.PGHOST?.trim() || DEFAULT_PGHOST,
		database,
		user: env.PGUSER?.trim() || undefined,
		password: env.PGPASSWORD || undefined,
		port: env.PGPORT?.trim() ? Number(env.PGPORT) : undefined
	};
}
