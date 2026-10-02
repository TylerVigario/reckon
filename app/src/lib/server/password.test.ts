import { describe, expect, it } from 'vitest';
import { CURRENT_HASH, hashPassword, verifyPassword } from './password.ts';

// Made by @node-rs/argon2, which hashed reckon's passwords before node:crypto
// did. Every hash already in a database looks like these, and must still verify.
const PASSWORD = 'correct horse battery staple';
const BEFORE = {
	today:
		'$argon2id$v=19$m=19456,t=2,p=1$vOFXoVYtnI/b8mslAYA6CA$q92eoSTKoBd7G5mLTg45booWk0Aci69cdOhRUkg7dNI',
	older:
		'$argon2id$v=19$m=4096,t=3,p=1$0doWgizRdBVTfpDBsNtjQg$BkMzYAgzD5rZxdA5B6zX1ZvjAjKMh519I/HcR5WWj2s'
};

describe('passwords', () => {
	it("hashes at today's parameters, and verifies its own hash", async () => {
		const stored = await hashPassword(PASSWORD);
		expect(stored.startsWith(CURRENT_HASH)).toBe(true);
		expect(await verifyPassword(stored, PASSWORD)).toBe(true);
		expect(await verifyPassword(stored, 'wrong')).toBe(false);
	});

	it('salts every hash, so one password never hashes the same twice', async () => {
		expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
	});

	it('verifies the hashes the previous library made, at either parameters', async () => {
		expect(await verifyPassword(BEFORE.today, PASSWORD)).toBe(true);
		expect(await verifyPassword(BEFORE.older, PASSWORD)).toBe(true);
		expect(await verifyPassword(BEFORE.today, 'wrong')).toBe(false);
	});

	it('answers no, not an error, to anything that is not an argon2id hash', async () => {
		for (const stored of [
			'',
			'plain',
			'$2b$10$bcrypt',
			BEFORE.today.replace('argon2id', 'argon2i')
		])
			expect(await verifyPassword(stored, PASSWORD)).toBe(false);
	});
});
