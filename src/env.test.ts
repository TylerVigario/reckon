import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { siteUrl, variables } from './env.ts';

/** What adapter-node reads, as its own source lists them (@sveltejs/adapter-node/src/env.js). */
const ADAPTER_NODE = new Set([
	'SOCKET_PATH',
	'HOST',
	'PORT',
	'XFF_DEPTH',
	'ADDRESS_HEADER',
	'PROTOCOL_HEADER',
	'HOST_HEADER',
	'PORT_HEADER',
	'BODY_SIZE_LIMIT',
	'SHUTDOWN_TIMEOUT',
	'IDLE_TIMEOUT',
	'KEEP_ALIVE_TIMEOUT',
	'HEADERS_TIMEOUT'
]);

/** Each name .env.example sets, or shows commented out, at the start of a line. */
const shown = new Set(
	[
		...readFileSync(new URL('../.env.example', import.meta.url), 'utf8').matchAll(
			/^(?:# )?([A-Z][A-Z0-9_]*)=/gm
		)
	].map(([, name]) => name)
);

describe('.env.example', () => {
	it('shows every setting src/env.ts declares', () => {
		expect(Object.keys(variables).filter((name) => !shown.has(name))).toEqual([]);
	});

	it("shows nothing else but adapter-node's own", () => {
		expect([...shown].filter((name) => !(name in variables) && !ADAPTER_NODE.has(name))).toEqual(
			[]
		);
	});
});

describe('SITE_URL', () => {
	it('is kept as the origin links begin with', () => {
		expect(siteUrl('https://reckon.example.com')).toBe('https://reckon.example.com');
		expect(siteUrl('https://reckon.example.com/')).toBe('https://reckon.example.com');
		expect(siteUrl('https://reckon.example.com:8443')).toBe('https://reckon.example.com:8443');
	});

	it('takes http only to this machine', () => {
		expect(siteUrl('http://localhost:5173')).toBe('http://localhost:5173');
		expect(siteUrl('http://127.0.0.1:5178')).toBe('http://127.0.0.1:5178');
		expect(siteUrl('http://[::1]:5173')).toBe('http://[::1]:5173');
		expect(() => siteUrl('http://reckon.example.com')).toThrow(/must be https/);
	});

	it('refuses what would end up in every link', () => {
		expect(() => siteUrl('https://reckon.example.com/app')).toThrow(/nothing more/);
		expect(() => siteUrl('https://reckon.example.com/?x=1')).toThrow(/nothing more/);
		expect(() => siteUrl('https://reckon.example.com/#top')).toThrow(/nothing more/);
		expect(() => siteUrl('https://me:pw@reckon.example.com')).toThrow(/nothing more/);
	});

	it('refuses what is no address, or not a web one', () => {
		expect(() => siteUrl('reckon.example.com')).toThrow(/is an address/);
		expect(() => siteUrl('ftp://reckon.example.com')).toThrow(/must be https/);
	});
});
