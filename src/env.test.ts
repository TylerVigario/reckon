import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { variables } from './env.ts';

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
