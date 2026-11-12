import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { requestFields, settings } from './log.ts';

/** What a line holds, as far as these tests read it. */
type Line = {
	msg?: string;
	time?: string;
	level?: string;
	event?: string;
	token?: string;
	headers?: { cookie?: string; accept?: string };
	err?: { type?: string; message?: string };
	[field: string]: unknown;
};
const read = (line: string) => JSON.parse(line) as Line;

/** A logger with the server's settings, writing into an array of lines. */
function capture() {
	const lines: string[] = [];
	const sink = new Writable({
		write(chunk, _encoding, done) {
			lines.push(...String(chunk).split('\n').filter(Boolean));
			done();
		}
	});
	return { log: pino(settings, sink), lines };
}

describe('the log', () => {
	it('writes each record as one JSON line, a line break inside a value escaped', () => {
		const { log, lines } = capture();
		log.warn({ 'user.id': 'avery' }, 'refused\n{"level":"info","msg":"someone else signed in"}');
		expect(lines).toHaveLength(1);
		const record = read(lines[0]);
		expect(record.msg).toBe('refused\n{"level":"info","msg":"someone else signed in"}');
		expect(record['user.id']).toBe('avery');
	});

	it('says when in UTC, and the level by name, with no pid or host', () => {
		const { log, lines } = capture();
		log.info({ event: 'sys_startup' }, 'reckon started');
		const record = read(lines[0]);
		expect(record.time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
		expect(record.level).toBe('info');
		expect(record.event).toBe('sys_startup');
		expect(record).not.toHaveProperty('pid');
		expect(record).not.toHaveProperty('hostname');
	});

	it('keeps a secret, token or cookie out, wherever it is handed over by name', () => {
		const { log, lines } = capture();
		log.info({ token: 'abc', headers: { cookie: 'reckon.session=xyz', accept: '*/*' } }, 'x');
		const record = read(lines[0]);
		expect(record.token).toBe('[kept out]');
		expect(record.headers?.cookie).toBe('[kept out]');
		expect(record.headers?.accept).toBe('*/*');
		expect(lines[0]).not.toContain('xyz');
	});

	it("records an error's type and message, with its stack", () => {
		const { log, lines } = capture();
		log.error({ err: new TypeError('bad\nworse') }, 'An error nobody meant');
		const record = read(lines[0]);
		expect(record.err?.type).toBe('TypeError');
		expect(record.err?.message).toBe('bad\nworse');
		expect(lines).toHaveLength(1);
	});
});

describe("a request's fields", () => {
	const event = (address: () => string) => ({
		request: new Request('https://reckon.example.com/team/0195?token=secret', {
			method: 'POST',
			headers: { 'user-agent': 'Mozilla/5.0 (Test)' }
		}),
		route: { id: '/team/[id]' },
		getClientAddress: address,
		locals: { user: { id: 'avery' } }
	});

	it("are OpenTelemetry's, with the route's template rather than the path", () => {
		expect(requestFields(event(() => '203.0.113.7'))).toEqual({
			'http.request.method': 'POST',
			'http.route': '/team/[id]',
			'client.address': '203.0.113.7',
			'user_agent.original': 'Mozilla/5.0 (Test)',
			'user.id': 'avery'
		});
	});

	it('leave the address out where there is none to read', () => {
		const fields = requestFields(
			event(() => {
				throw new Error('no address while building');
			})
		);
		expect(fields['client.address']).toBeUndefined();
	});
});
