import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';
import { readSecretFile } from '#lib/server/secret-file.ts';

/**
 * Everything the application reads from its environment, once.
 *
 * Read when the server starts, never inlined at build: the same built artifact
 * runs on any host with any values. A value that fails its check stops the
 * server at start with the reason, rather than surfacing as a broken request
 * later. The build itself has none of them, so it checks nothing.
 * .env.example is the same list as a file to copy (src/env.test.ts keeps the
 * two in step).
 *
 * Nothing is assumed that differs between one deployment and the next: which
 * database, and the secret that signs sessions, are said in development too.
 * What has a default is one that is right wherever it is left unset.
 *
 * A secret can be given as a file instead, X_FILE naming it in X's place
 * (#lib/server/secret-file): its _FILE variable reads it here, once, and the
 * code that uses the secret takes one or the other, never both.
 *
 * Not here, because the application does not read them: adapter-node's own
 * HOST, PORT, PROTOCOL_HEADER, HOST_HEADER, ADDRESS_HEADER and XFF_DEPTH.
 *
 * Nor is the site's public address. There is none to set: the server reads it
 * from each request -- the Host header, over https unless PROTOCOL_HEADER names
 * a header that says otherwise -- so it cannot disagree with the address a
 * browser actually used.
 */

/** A key that is blank is a key that is not set. */
const optional = (value: string | undefined) => value?.trim() || undefined;

/** A secret shorter than this is not one: 32 characters is Better Auth's own floor. */
const SHORTEST_SECRET = 32;

/** The session secret, however it is given, if it is long enough to be one. */
const sessionSecret = (what: string, secret: string | undefined) => {
	if (secret !== undefined && secret.length < SHORTEST_SECRET)
		throw new Error(
			`${what} must be ${SHORTEST_SECRET} characters at least -- it signs every session. ` +
				'`openssl rand -hex 32` makes one.'
		);
	return secret;
};

/** What the file a _FILE variable names holds; nothing is read while building. */
const fromFile = (name: string) => (value: string | undefined) => {
	const path = optional(value);
	return path === undefined || building ? undefined : readSecretFile(name, path);
};

export const variables = defineEnvVars({
	BETTER_AUTH_SECRET: {
		description:
			"Signs every session cookie. 32 characters at least, random, and this deployment's alone -- `openssl rand -hex 32`. Changing it signs everybody out.",
		// Required everywhere, `vite dev` too, this or BETTER_AUTH_SECRET_FILE
		// (#lib/server/auth). Left unset, Better Auth signs with a default printed
		// in its own source, with which anyone could make a session -- on a dev
		// server the network can reach, too. Taken as given: only a blank one is
		// not set.
		schema: (value) => {
			const secret = value?.trim() ? value : undefined;
			return building ? secret : sessionSecret('BETTER_AUTH_SECRET', secret);
		}
	},

	BETTER_AUTH_SECRET_FILE: {
		description:
			'The path of a file holding BETTER_AUTH_SECRET, in its place: read once at start, the whitespace around it not part of it. Set one of the two.',
		schema: (value) =>
			sessionSecret(
				'What BETTER_AUTH_SECRET_FILE holds',
				fromFile('BETTER_AUTH_SECRET_FILE')(value)
			)
	},

	SECURE_COOKIES: {
		description:
			'Whether the session cookie is Secure, so a browser only ever sends it over https. true unless set; false only behind a proxy that serves plain http, where it costs the session token crossing the network in the clear.',
		schema: (value = 'true') => {
			if (value === 'true') return true;
			if (value === 'false') return false;
			throw new Error(`SECURE_COOKIES must be true or false, not '${value}'.`);
		}
	},

	DATABASE_URL: {
		description:
			'Wins outright over PGHOST and PGDATABASE: for TCP, another machine, or a managed service. A postgres:// or postgresql:// URL.',
		// Checked at start rather than at the first query, and named without its
		// value, which can carry a password.
		schema: (value) => {
			const url = optional(value);
			if (url === undefined || building) return url;
			if (!URL.canParse(url) || !['postgres:', 'postgresql:'].includes(new URL(url).protocol))
				throw new Error('DATABASE_URL is set but is not a postgres:// or postgresql:// URL.');
			return url;
		}
	},

	PGHOST: {
		description:
			"Where the database is. By default where libpq looks on this platform (#lib/server/db/defaults): the unix socket Linux packages make, which signs in as the server's own system user with no password; /tmp on macOS; localhost on Windows.",
		schema: optional
	},

	PGDATABASE: {
		description:
			'Which database: reckon_dev, say, in development. Required where DATABASE_URL is unset (#lib/server/db), since none is assumed.',
		schema: optional
	},

	// The pg driver would read these three by itself, but from the process's
	// environment, which `vite dev` does not put .env into: declared, they reach
	// the connection from .env as well.
	PGUSER: {
		description: "Who to connect as. The server's own system user unless set.",
		schema: optional
	},

	PGPASSWORD: {
		description:
			"PGUSER's password, where the database asks for one. Over the unix socket on Linux it does not.",
		schema: (value) => value || undefined
	},

	PGPASSFILE: {
		description:
			"libpq's password file, for a database that asks for one: ~/.pgpass unless set. Only its owner may read it, or it is passed over, as libpq passes over it (#lib/server/db/defaults).",
		schema: optional
	},

	PGPORT: {
		description: '5432 unless set.',
		schema: (value) => {
			const port = optional(value);
			if (port !== undefined && !/^\d+$/.test(port))
				throw new Error(`PGPORT is a port number, not '${port}'.`);
			return port;
		}
	},

	GOOGLE_MAPS_API_KEY: {
		description:
			"The server's Google key: validates a chosen address, confirms a place id, and gives each drive of a trip its miles by Google's route. Restrict it to this host's IP addresses and to the Address Validation, Places (New) and Routes APIs. Unset, an address is stored as Google returned it, and a trip's miles are typed or come from earlier trips.",
		schema: optional
	},

	GOOGLE_MAPS_API_KEY_FILE: {
		description:
			'The path of a file holding GOOGLE_MAPS_API_KEY, in its place: read once at start, the whitespace around it not part of it. Set one of the two.',
		schema: fromFile('GOOGLE_MAPS_API_KEY_FILE')
	},

	PUBLIC_GOOGLE_MAPS_API_KEY: {
		// PUBLIC_ is no longer what makes it public -- `public: true` is. The
		// prefix stays because it is what tells whoever fills in the environment
		// that this value reaches every browser.
		public: true,
		description:
			"The browser's Google key: address lookup as you type. It reaches every browser, so restrict it to this deployment's HTTP referrers. Unset, addresses are typed.",
		schema: optional
	}
});
