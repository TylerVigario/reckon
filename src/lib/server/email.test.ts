import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ SMTP_SECURITY: 'starttls' }));
vi.mock('./db/index.ts', () => ({ db: {}, pool: {} }));
const { againAfter, isLoopback, relayOptions } = await import('./email.ts');

describe('the relay', () => {
	it('must upgrade to TLS by STARTTLS unless told otherwise, on 587', () => {
		expect(relayOptions({ host: 'smtp.example.com', security: 'starttls' })).toMatchObject({
			port: 587,
			secure: false,
			requireTLS: true,
			ignoreTLS: false
		});
	});

	it('speaks TLS from the first byte under tls, on 465', () => {
		expect(relayOptions({ host: 'smtp.example.com', security: 'tls' })).toMatchObject({
			port: 465,
			secure: true,
			requireTLS: false
		});
	});

	it('takes the port it is given, as clouds that block 587 need', () => {
		expect(relayOptions({ host: 'smtp.example.com', port: 2587, security: 'starttls' }).port).toBe(
			2587
		);
	});

	it('is never sent to below TLS 1.2, and its certificate is never left unchecked', () => {
		for (const security of ['starttls', 'tls', 'none'] as const) {
			const { tls } = relayOptions({ host: '127.0.0.1', security });
			expect(tls.minVersion).toBe('TLSv1.2');
			expect(tls).not.toHaveProperty('rejectUnauthorized');
		}
	});

	it('is trusted by the authorities a CA file names, in place of the system’s', () => {
		const ca = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
		expect(relayOptions({ host: '127.0.0.1', security: 'starttls', ca }).tls.ca).toBe(ca);
	});

	it('is signed in to whenever there is someone to sign in as, offered or not', () => {
		expect(
			relayOptions({
				host: 'email-smtp.us-west-2.amazonaws.com',
				security: 'starttls',
				username: 'AKIAEXAMPLE',
				password: 'a/b+c'
			})
		).toMatchObject({ auth: { user: 'AKIAEXAMPLE', pass: 'a/b+c' }, forceAuth: true });
		expect(relayOptions({ host: '127.0.0.1', security: 'none' })).toMatchObject({
			auth: undefined,
			forceAuth: false
		});
	});

	it('takes a username only with a password, and the other way about', () => {
		expect(() =>
			relayOptions({ host: 'smtp.example.com', security: 'tls', username: 'u' })
		).toThrow(/go together/);
		expect(() =>
			relayOptions({ host: 'smtp.example.com', security: 'tls', password: 'p' })
		).toThrow(/go together/);
	});

	it('without TLS, is sent a password only on this machine', () => {
		const signIn = { username: 'u', password: 'p' };
		expect(() => relayOptions({ host: 'relay.lan', security: 'none', ...signIn })).toThrow(
			/in the clear/
		);
		for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]'])
			expect(relayOptions({ host, security: 'none', ...signIn }).ignoreTLS).toBe(true);
	});

	it('greets as it is told to, or as nodemailer would', () => {
		expect(relayOptions({ host: 'h', security: 'tls', heloName: 'kestrel.example' }).name).toBe(
			'kestrel.example'
		);
		expect(relayOptions({ host: 'h', security: 'tls' }).name).toBeUndefined();
	});
});

describe('this machine', () => {
	it('is loopback, by name or address', () => {
		for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]'])
			expect(isLoopback(host), host).toBe(true);
		for (const host of ['192.168.1.10', 'relay.lan', 'localhost.example.com', '::2'])
			expect(isLoopback(host), host).toBe(false);
	});
});

describe('a message the relay put off', () => {
	it('is tried later each time, then hourly', () => {
		expect([1, 2, 3, 4, 5, 20].map(againAfter)).toEqual([60, 300, 900, 3600, 3600, 3600]);
	});
});
