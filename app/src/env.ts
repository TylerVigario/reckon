import { defineEnvVars } from '@sveltejs/kit/env';
import { building, dev } from '$app/env';

/**
 * Everything the application reads from its environment, once.
 *
 * Read when the server starts, never inlined at build: the same built artifact
 * runs on any host with any values. A value that fails its check stops the
 * server at start with the reason, rather than surfacing as a broken request
 * later. The build itself has none of them, so it checks nothing.
 *
 * Not here, because the application does not read them: adapter-node's own
 * HOST, PORT, PROTOCOL_HEADER, HOST_HEADER, ADDRESS_HEADER and XFF_DEPTH, and
 * the PGUSER/PGPASSWORD/PGPORT that the pg driver reads by itself.
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

export const variables = defineEnvVars({
	BETTER_AUTH_SECRET: {
		description:
			"Signs every session cookie. 32 characters at least, random, and this deployment's alone -- `openssl rand -hex 32`. Changing it signs everybody out.",
		// Required everywhere but `vite dev`. Left unset, Better Auth signs with a
		// default printed in its own source.
		schema: (value) => {
			if (dev || building) return value;
			if ((value ?? '').length < SHORTEST_SECRET)
				throw new Error(
					`BETTER_AUTH_SECRET must be set, ${SHORTEST_SECRET} characters at least -- it signs every session. ` +
						'`openssl rand -hex 32` makes one.'
				);
			return value;
		}
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
			'Where the database is. By default the unix socket Linux packages create, which authenticates by operating-system user rather than by password.',
		schema: (value) => optional(value) ?? '/var/run/postgresql'
	},

	PGDATABASE: {
		description: 'Which database.',
		schema: (value) => optional(value) ?? 'reckon_dev'
	},

	GOOGLE_MAPS_API_KEY: {
		description:
			"The server's Google key: validates a chosen address, confirms a place id, and gives each drive of a trip its miles by Google's route. Restrict it to this host's IP addresses and to the Address Validation, Places (New) and Routes APIs. Unset, an address is stored as Google returned it, and a trip's miles are typed or come from earlier trips.",
		schema: optional
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
