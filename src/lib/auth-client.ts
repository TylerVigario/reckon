import { createAuthClient } from 'better-auth/svelte';
import { passkeyClient } from '@better-auth/passkey/client';

/**
 * Better Auth in the browser, as its SvelteKit guide makes it, with its passkey
 * plugin: the ceremonies to sign in with a passkey and to make one, against
 * the routes #lib/server/auth-paths serves under /api/auth on this origin.
 * Nothing else of it is used here; the rest of signing in and out is form
 * actions.
 */
export const authClient = createAuthClient({ plugins: [passkeyClient()] });

/**
 * Whether this browser can use a passkey at all. Inside some apps' own
 * browsers -- an email app's, a social app's -- it cannot, and the page says to
 * open the link in the phone's own browser instead.
 */
export const passkeysWork = () =>
	typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

/** Whether it offers saved passkeys as the email field is filled (autofill). */
export async function autofillWorks(): Promise<boolean> {
	if (!passkeysWork()) return false;
	try {
		return (await PublicKeyCredential.isConditionalMediationAvailable?.()) === true;
	} catch {
		return false;
	}
}
