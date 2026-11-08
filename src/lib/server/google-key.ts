import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_API_KEY_FILE } from '$app/env/private';
import { eitherOf } from './secret-file.ts';

/**
 * The server's Google key, as GOOGLE_MAPS_API_KEY gives it or as the file
 * GOOGLE_MAPS_API_KEY_FILE names holds it (#lib/server/secret-file). Undefined
 * when neither is set: addresses are then stored as Google returned them and a
 * trip's miles are typed (src/env.ts).
 */
export const googleKey = () =>
	eitherOf('GOOGLE_MAPS_API_KEY', GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_API_KEY_FILE);
