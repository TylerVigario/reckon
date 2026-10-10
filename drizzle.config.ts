import { defineConfig } from 'drizzle-kit';

/**
 * Generating a migration reads only the schema files (`npm run db:generate --
 * --name what-changed`, or `--custom` for one Drizzle cannot write). Applying
 * one is the server's, when it starts, and `npm run db:migrate`'s
 * (#lib/server/db/migrate) -- never drizzle-kit's.
 */
export default defineConfig({
	schema: './src/lib/server/db/schema/index.ts',
	out: './drizzle',
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
