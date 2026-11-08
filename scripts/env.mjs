/**
 * Not a command: what the commands and checks that reach the database import
 * first, so they read the .env beside vite.config.ts as `npm run dev` does,
 * under whatever the shell sets. (The dev server reads Vite's others too, as
 * .env.local; these read .env alone.) With none, they read the shell's alone,
 * as they do in production.
 */
import { connectionFrom, NO_DATABASE } from '../src/lib/server/db/defaults.js';

try {
	process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
	if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
}

/**
 * The database the server would use, connected to as it would be
 * (#lib/server/db/defaults). With none named, it says why and stops.
 *
 * @returns {import('pg').ClientConfig}
 */
export function database() {
	const where = connectionFrom(process.env);
	if (where) return where;
	console.error(NO_DATABASE);
	process.exit(2);
}
