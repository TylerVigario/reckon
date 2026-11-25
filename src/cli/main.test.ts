import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP, main } from './main.ts';
import type { Context } from './command.ts';

// Nothing here reaches a database: each is refused, or answered, first.
const context: Context = {
	version: '1.2.3',
	database: () => {
		throw new Error('asked for the database');
	}
};

let out: string[];
let err: string[];
beforeEach(() => {
	out = [];
	err = [];
	vi.spyOn(console, 'log').mockImplementation((s: string) => void out.push(s));
	vi.spyOn(console, 'error').mockImplementation((s: string) => void err.push(s));
});
afterEach(() => vi.restoreAllMocks());

describe('bin/reckon', () => {
	it('says what it takes on standard output, and exits 0, with --help', async () => {
		expect(await main(['--help'], context)).toBe(0);
		expect(out).toEqual([HELP]);
		for (const name of ['migrate', 'user', 'tax'])
			expect(HELP).toMatch(new RegExp(`^  ${name} `, 'm'));
		expect(err).toEqual([]);
	});

	it('says which reckon it is, with --version', async () => {
		expect(await main(['--version'], context)).toBe(0);
		expect(out).toEqual(['reckon 1.2.3']);
	});

	it('does nothing else once --help or --version is seen', async () => {
		expect(await main(['--help', 'migrate'], context)).toBe(0);
		expect(await main(['--version', 'nope'], context)).toBe(0);
		expect(err).toEqual([]);
	});

	it('asked nothing, says what it takes on standard error, and exits 2', async () => {
		expect(await main([], context)).toBe(2);
		expect(err).toEqual([HELP]);
		expect(out).toEqual([]);
	});

	it('refuses a command or an option it does not have', async () => {
		expect(await main(['nope'], context)).toBe(2);
		expect(await main(['--nope'], context)).toBe(2);
		expect(err).toEqual([
			'There is no command nope. bin/reckon --help says what there is.',
			'There is no option --nope. bin/reckon --help says what there is.'
		]);
	});

	it("gives a command's own help with --help anywhere before --", async () => {
		expect(await main(['user', 'add', '--help'], context)).toBe(0);
		expect(out[0]).toMatch(/^usage: bin\/reckon user list\n/);
		expect(await main(['tax', '--help'], context)).toBe(0);
		expect(out[1]).toMatch(/^usage: bin\/reckon tax refresh/);
	});

	it('refuses what a command does not take, with its usage, before reaching the database', async () => {
		const refused = async (args: string[]) => {
			err = [];
			expect(await main(args, context)).toBe(2);
			return err.join('\n');
		};
		expect(await refused(['migrate', 'reckon_dev'])).toMatch(/^migrate takes no database/);
		expect(await refused(['user'])).toMatch(/^Which: list, add, invite or end\?\n\nusage:/);
		expect(await refused(['user', 'remove', 'a@b.c'])).toMatch(/^There is no user remove/);
		expect(await refused(['user', 'add', 'a@b.c'])).toMatch(/^add takes an email and a name\./);
		expect(await refused(['user', 'invite'])).toMatch(/^invite takes an email\./);
		expect(await refused(['user', 'list', '--full'])).toMatch(
			/^Unknown option '--full'\.\n\nusage: bin\/reckon user list/
		);
		expect(await refused(['user', 'add', 'a@b.c', 'A', '--role'])).toMatch(
			/^Option '--role <value>' argument missing\n/
		);
		expect(await refused(['user', 'add', 'a@b.c', 'A', '--role='])).toMatch(
			/^--role takes the name of a role\./
		);
		expect(await refused(['tax'])).toMatch(/^tax has one command, refresh\./);
		expect(await refused(['tax', 'refresh', 'now'])).toMatch(/^refresh takes no operands/);
		expect(await refused(['tax', 'refresh', '--dryrun'])).toMatch(/^Unknown option '--dryrun'\./);
		expect(out).toEqual([]);
	});
});
