/**
 * RECKON'S COMMAND, for whoever runs one: `bin/reckon <command>`, the same in
 * a clone and a release (bin/reckon). What a host does to a reckon apart from
 * starting it: bringing its database up to date, the people who sign in when
 * nobody can add them on Team, and its tax rates now rather than within the
 * hour.
 *
 * Arguments are read by Node's own parser (util.parseArgs), strictly, so an
 * option a command doesn't take, or one missing its value, is refused rather
 * than ignored. As the GNU Coding Standards ask of every program, --help and
 * --version say what it takes and which it is, "on standard output, then exit
 * successfully", and once either is seen nothing else is done. What it can't
 * take goes to standard error with its usage, and exits 2; what it was asked
 * and couldn't do, why, and exits 1.
 *
 * What the business's developers run on a clone alone -- seeding, testing
 * the database, its types, printing, making a release -- stays npm's
 * (package.json scripts): they need the source tree and its packages, and a
 * real business's database should never get the demo seed.
 */
import { Failed, Usage, type Command, type Context } from './command.ts';
import { migrate } from './migrate.ts';
import { user } from './user.ts';
import { tax } from './tax.ts';

const COMMANDS: Record<string, Command> = { migrate, user, tax };

/** `bin/reckon --help`. */
export const HELP = `usage: bin/reckon <command> [<args>]

${Object.entries(COMMANDS)
	.map(([name, c]) => `  ${name.padEnd(9)}${c.summary}`)
	.join('\n')}

bin/reckon <command> --help says what each takes.
bin/reckon --version says which reckon this is.`;

/** Whether `args` ask for help: --help anywhere before a `--`, after which nothing is an option. */
const asksHelp = (args: string[]) => {
	const end = args.indexOf('--');
	return (end === -1 ? args : args.slice(0, end)).includes('--help');
};

/** What util.parseArgs throws for arguments it was told not to take. */
const refusedByParser = (e: unknown): e is Error =>
	e instanceof Error && String((e as { code?: unknown }).code).startsWith('ERR_PARSE_ARGS_');

/**
 * Runs `argv`, the arguments bin/reckon was given, and says what it exits
 * with: 0 done, 1 not done and why, 2 not something it takes.
 */
export async function main(argv: string[], context: Context): Promise<number> {
	const [name, ...args] = argv;
	if (name === '--help') {
		console.log(HELP);
		return 0;
	}
	if (name === '--version') {
		console.log(`reckon ${context.version}`);
		return 0;
	}
	const command = name !== undefined && Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
	if (!command) {
		console.error(
			name === undefined
				? HELP
				: `${name.startsWith('-') ? `There is no option ${name}` : `There is no command ${name}`}. ` +
						'bin/reckon --help says what there is.'
		);
		return 2;
	}
	if (asksHelp(args)) {
		console.log(command.help);
		return 0;
	}
	try {
		return await command.run(args, context);
	} catch (e) {
		// The parser's first sentence is what was wrong; what follows is how to
		// pass an operand beginning with a dash, which nothing here takes.
		const refused =
			e instanceof Usage
				? e.message
				: refusedByParser(e)
					? e.message.replace(/(?<=\.) .*$/s, '')
					: null;
		if (refused !== null) {
			console.error(`${refused}\n\n${command.usage}`);
			return 2;
		}
		if (e instanceof Failed) {
			console.error(e.message);
			return 1;
		}
		throw e;
	}
}
