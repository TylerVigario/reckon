import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectionFrom } from './defaults.js';

// The module that reads the file passes it over while the process has a
// PGPASSWORD of its own, as the release's gate does: these say what is passed.
const ownPassword = process.env.PGPASSWORD;
beforeAll(() => {
	delete process.env.PGPASSWORD;
});
afterAll(() => {
	if (ownPassword !== undefined) process.env.PGPASSWORD = ownPassword;
});

const dir = mkdtempSync(join(tmpdir(), 'reckon-pgpass-'));
const passfile = (name: string, mode: number) => {
	const path = join(dir, name);
	writeFileSync(path, 'db.example:5433:reckon:avery:from-the-file\n*:*:*:*:any-line\n');
	chmodSync(path, mode);
	return path;
};

/** What the connection these settings make would send, when asked for a password. */
const passwordFor = (env: Record<string, string>) => {
	const where = connectionFrom({ PGHOST: 'db.example', PGDATABASE: 'reckon', ...env });
	return (where?.password as () => Promise<string | undefined>)();
};

describe("a database's password", () => {
	it('is PGPASSWORD when set', async () => {
		expect(await passwordFor({ PGPASSWORD: 'given', PGPASSFILE: passfile('a', 0o600) })).toBe(
			'given'
		);
	});

	it("is the connection's line in the password file PGPASSFILE names", async () => {
		const file = passfile('b', 0o600);
		expect(await passwordFor({ PGPASSFILE: file, PGUSER: 'avery', PGPORT: '5433' })).toBe(
			'from-the-file'
		);
		expect(await passwordFor({ PGPASSFILE: file, PGUSER: 'sam' })).toBe('any-line');
	});

	it('is not taken from a password file others may read, as libpq does not', async () => {
		expect(await passwordFor({ PGPASSFILE: passfile('c', 0o644), PGUSER: 'avery' })).toBe(
			undefined
		);
	});

	it('is none where there is no password file', async () => {
		expect(await passwordFor({ PGPASSFILE: join(dir, 'missing') })).toBe(undefined);
	});

	it('is left to DATABASE_URL, which carries its own', () => {
		expect(connectionFrom({ DATABASE_URL: 'postgresql://u:p@h/d' })).toEqual({
			connectionString: 'postgresql://u:p@h/d'
		});
	});
});
