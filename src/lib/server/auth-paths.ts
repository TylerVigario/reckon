/**
 * WHICH OF BETTER AUTH'S ROUTES ARE SERVED, under /api/auth (#lib/server/auth).
 *
 * Mounted, Better Auth answers every route of its own and of each plugin. Each
 * one reckon serves is in OPEN, each one it turns away is in CLOSED, and
 * src/lib/server/auth-paths.test.ts fails on a route in neither -- so a route
 * a new release adds is looked at before it is served, not found later.
 *
 * Open are the four a passkey's ceremonies need the browser to reach: being
 * asked for one, and answering, to make one and to sign in with one. Listing,
 * naming and removing passkeys are Your profile's own form actions, which call
 * the plugin directly, as signing out is:
 * `disabledPaths` does not reach a direct call.
 *
 * `disabledPaths` matches a path exactly, so a route with a parameter in it
 * cannot be listed: Better Auth closed the issue asking for it as not planned
 * (better-auth/better-auth#4843), and `enabledPaths`, which would serve only
 * what is listed, is an open pull request (better-auth/better-auth#11078).
 * Until it ships, those routes stay served, each in UNCLOSED with why that is
 * harmless here, and tests/auth-routes-check.mjs holds them to it.
 */

/** Served to the browser. */
export const OPEN_AUTH_PATHS: readonly string[] = [
	'/passkey/generate-authenticate-options',
	'/passkey/generate-register-options',
	'/passkey/verify-authentication',
	'/passkey/verify-registration'
];

/** Answered 404, whatever the method, through `disabledPaths`. */
export const CLOSED_AUTH_PATHS: readonly string[] = [
	'/account-info',
	'/change-email',
	'/change-password',
	'/delete-user',
	'/delete-user/callback',
	'/error',
	'/get-access-token',
	'/get-session',
	'/link-social',
	'/list-accounts',
	'/list-sessions',
	'/ok',
	'/passkey/delete-passkey',
	'/passkey/list-user-passkeys',
	'/passkey/update-passkey',
	'/refresh-token',
	'/request-password-reset',
	'/reset-password',
	'/revoke-other-sessions',
	'/revoke-session',
	'/revoke-sessions',
	'/send-verification-email',
	'/sign-in/email',
	'/sign-in/social',
	'/sign-out',
	'/sign-up/email',
	'/unlink-account',
	'/update-session',
	'/update-user',
	'/verify-email',
	'/verify-password'
];

/** Served because `disabledPaths` cannot name them, and why each does nothing here. */
export const UNCLOSED_AUTH_PATHS: Readonly<Record<string, string>> = {
	'/reset-password/:token':
		'Hands a password-reset token to its callbackURL, which must be this origin; reckon issues no such token (its own links are #lib/server/links), so every one is invalid.',
	'/callback/:id':
		'Where a social sign-in provider returns; reckon configures none, and with no state of its own the callback only reports an error.'
};
