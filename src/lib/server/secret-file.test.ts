import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eitherOf, readSecretFile } from './secret-file.ts';

const dir = mkdtempSync(join(tmpdir(), 'reckon-secret-'));
const file = (name: string, text: string) => {
	const path = join(dir, name);
	writeFileSync(path, text, { mode: 0o600 });
	return path;
};

describe('a secret given as a file', () => {
	it('is what the file holds, without the newline it ends with', () => {
		expect(readSecretFile('X_FILE', file('ends', 's3cret\n'))).toBe('s3cret');
		expect(readSecretFile('X_FILE', file('crlf', '  s3cret\r\n'))).toBe('s3cret');
	});

	it('is refused when the file holds nothing else', () => {
		expect(() => readSecretFile('X_FILE', file('empty', '\n'))).toThrow(
			`X_FILE names ${join(dir, 'empty')}, which is empty.`
		);
	});

	it('is refused, naming the setting and the path, when the file cannot be read', () => {
		expect(() => readSecretFile('X_FILE', join(dir, 'missing'))).toThrow(
			`X_FILE names ${join(dir, 'missing')}, which cannot be read (ENOENT).`
		);
	});
});

describe('a secret given one way or the other', () => {
	it('is whichever is given', () => {
		expect(eitherOf('X', 'a', undefined)).toBe('a');
		expect(eitherOf('X', undefined, 'b')).toBe('b');
		expect(eitherOf('X', undefined, undefined)).toBeUndefined();
	});

	it('is refused when given both ways', () => {
		expect(() => eitherOf('X', 'a', 'b')).toThrow('X and X_FILE are both set: set one of them.');
	});
});
