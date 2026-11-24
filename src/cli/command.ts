import type { ClientConfig } from 'pg';

/**
 * What a command is handed by bin/reckon: which reckon this is, and the
 * database the server would use (#lib/server/db/defaults), asked for only once
 * the command needs it, so --help needs none.
 */
export type Context = {
	version: string;
	database: () => ClientConfig;
};

/** One of reckon's commands: what it is for, how it is run, and running it. */
export type Command = {
	/** What it is for, in a few words, for `bin/reckon --help`. */
	summary: string;
	/** How it is run, one line for each way. */
	usage: string;
	/** Its --help: the usage, and what each way does. */
	help: string;
	/** Runs it with what followed its name, and says what it exits with. */
	run: (args: string[], context: Context) => Promise<number>;
};

/**
 * What it was given that it doesn't take. Said on standard error with its
 * usage, and the command exits 2.
 */
export class Usage extends Error {}

/**
 * What it was asked to do, refused or unreachable, and why. Said on standard
 * error, and the command exits 1.
 */
export class Failed extends Error {}

/**
 * `positionals`, if there are `count` of them; `what` says what the command
 * takes when there aren't.
 */
export function operands(positionals: string[], count: number, what: string): string[] {
	if (positionals.length !== count) throw new Usage(what);
	return positionals;
}
