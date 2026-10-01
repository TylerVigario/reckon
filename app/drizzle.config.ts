import { defineConfig } from 'drizzle-kit';

/**
 * Generating a migration reads only the schema files. Applying one is
 * db/apply.sh's job, which runs scripts/migrate.mjs on the host.
 */
export default defineConfig({
	schema: './src/lib/server/db/schema/index.ts',
	out: '../db/migrations',
	dialect: 'postgresql',
	// Must match the client (src/lib/server/db/index.ts): it is what maps
	// workedOn to worked_on, at runtime there and in migrations here.
	casing: 'snake_case',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'postgresql:///reckon_dev?host=/var/run/postgresql'
	},
	strict: true,
	verbose: true
});
