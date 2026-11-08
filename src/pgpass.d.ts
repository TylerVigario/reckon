// pgpass publishes no types. These are the calls reckon makes
// (src/lib/server/db/defaults.js): its helpers rather than its entry point,
// which reads PGPASSFILE from the process's environment alone, and so not from
// the .env `vite dev` reads.
declare module 'pgpass/lib/helper.js' {
	import type { Stats } from 'node:fs';
	import type { Readable } from 'node:stream';

	const helper: {
		/** PGPASSFILE, else ~/.pgpass, or %APPDATA%\postgresql\pgpass.conf on Windows. */
		getFileName(env: Record<string, string | undefined>): string;
		/** Whether the file may be used: a plain file only its owner may read. */
		usePgPass(stats: Stats, file: string): boolean;
		/** The password on the first line matching the connection, if any. */
		getPassword(
			connection: { host: string; port: number; database: string; user: string },
			file: Readable,
			found: (password: string | undefined) => void
		): void;
	};
	export default helper;
}
