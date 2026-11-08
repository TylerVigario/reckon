import { readFileSync } from 'node:fs';

/**
 * A secret can be given as a file rather than in the environment: X_FILE, the
 * path of a file holding X (src/env.ts), as Docker's official images take one
 * and as systemd hands over a credential (LoadCredential=, its path given as
 * %d/<name>). An environment is inherited by every process started under it
 * and, for a systemd unit's Environment=, readable over D-Bus; a file is read
 * by whoever may read the file.
 *
 * The file is read once, as the server starts. The whitespace around what it
 * holds -- the newline an editor ends it with, above all -- is not part of the
 * secret, and a file with nothing else in it is refused. What it holds stays in
 * the process, never written into its environment.
 */

/** What the file `name` names holds, or why it cannot be used. */
export function readSecretFile(name: string, path: string): string {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (e) {
		const why = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
		throw new Error(`${name} names ${path}, which cannot be read (${why}).`, { cause: e });
	}
	const secret = text.trim();
	if (secret === '') throw new Error(`${name} names ${path}, which is empty.`);
	return secret;
}

/**
 * A secret given one way or the other, never both: given twice, which is meant
 * cannot be told, so the server stops rather than pick one.
 */
export function eitherOf(
	name: string,
	value: string | undefined,
	fromFile: string | undefined
): string | undefined {
	if (value !== undefined && fromFile !== undefined)
		throw new Error(`${name} and ${name}_FILE are both set: set one of them.`);
	return value ?? fromFile;
}
