// Where the database is when nothing says otherwise, and which one it is, which
// nothing assumes. Plain JavaScript, so the server, the commands in scripts/ and
// the checks in tests/, which run with no build step, share one answer.

import { createReadStream, stat } from 'node:fs';
import { userInfo } from 'node:os';
import passfile from 'pgpass/lib/helper.js';

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
 * The password pg asks for, when the database asks for one: PGPASSWORD, else the
 * line for this connection in libpq's password file -- PGPASSFILE, else
 * ~/.pgpass, or %APPDATA%\postgresql\pgpass.conf on Windows -- which psql reads
 * too. A file anyone but its owner may read is passed over, as libpq passes
 * over it. Over the unix socket on Linux nothing is asked.
 *
 * pg reads that file itself, but deprecated: it warns, and pg 9 drops it. So it
 * is read here, with the module pg reads it with.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ host: string, database: string, user: string | undefined, port: number | undefined }} at
 * @returns {() => Promise<string | undefined>}
 */
const passwordFor = (env, at) => () => {
	if (env.PGPASSWORD) return Promise.resolve(env.PGPASSWORD);
	const file = passfile.getFileName({
		PGPASSFILE: env.PGPASSFILE?.trim() || undefined,
		HOME: process.env.HOME,
		APPDATA: process.env.APPDATA
	});
	const line = {
		host: at.host,
		port: at.port ?? 5432,
		database: at.database,
		user: at.user ?? userInfo().username
	};
	// No line for this connection answers undefined; pg then connects with no
	// password, and the server's refusal is the error shown.
	return new Promise((resolve) =>
		stat(file, (error, stats) => {
			if (error || !passfile.usePgPass(stats, file)) return resolve(undefined);
			passfile.getPassword(line, createReadStream(file), resolve);
		})
	);
};

/**
 * How to reach the database these settings name, the one rule the server and
 * every command connect by: DATABASE_URL outright, or PGDATABASE at PGHOST, as
 * PGUSER, PGPASSWORD (or libpq's password file) and PGPORT say. Undefined where
 * neither is named, which NO_DATABASE says why.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {import('pg').ClientConfig | undefined}
 */
export function connectionFrom(env) {
	const url = env.DATABASE_URL?.trim();
	if (url) return { connectionString: url };
	const database = env.PGDATABASE?.trim();
	if (!database) return undefined;
	const at = {
		host: env.PGHOST?.trim() || DEFAULT_PGHOST,
		database,
		user: env.PGUSER?.trim() || undefined,
		port: env.PGPORT?.trim() ? Number(env.PGPORT) : undefined
	};
	// pg takes undefined from it as no password, though its types say a string.
	return { ...at, password: /** @type {() => Promise<string>} */ (passwordFor(env, at)) };
}
