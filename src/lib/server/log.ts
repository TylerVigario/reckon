// The log: one JSON line for each thing the server records, on standard output,
// where whatever runs it keeps it -- journald, under a service unit. The README's
// "Logging" says what is recorded, and where (ASVS 5.0 16.1.1).
//
// JSON, so a line break inside a value is written as \n and can never begin a
// line of its own: what anyone types cannot forge a record (16.4.1). Times are
// ISO 8601 in UTC (16.2.2). An event is named as OWASP's Logging Vocabulary
// names it, in the field OWASP's own example calls `event`; every other field
// has OpenTelemetry's name for it (16.2.4).
//
// Plain TypeScript over pino, with nothing of SvelteKit's, so the commands in
// scripts/ log as the server does.
import pino from 'pino';

/**
 * What is never written, whatever an object handed to the log carries: a
 * secret, a token or a cookie by name (OWASP Logging Cheat Sheet, "Data to
 * exclude"). Nothing should hand one over; this is the net beneath that.
 */
export const KEPT_OUT = [
	'token',
	'secret',
	'password',
	'cookie',
	'authorization',
	'*.token',
	'*.secret',
	'*.password',
	'*.cookie',
	'*.authorization'
];

/** The logger's settings, apart from where it writes: the tests write elsewhere. */
export const settings: pino.LoggerOptions = {
	// No pid or hostname: the journal records both beside each line.
	base: undefined,
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: { level: (label) => ({ level: label }) },
	redact: { paths: KEPT_OUT, censor: '[kept out]' }
};

export const log = pino(settings);

/**
 * What a request says about who asked and how, in OpenTelemetry's names: the
 * route's template rather than the path, which can carry an id or a token.
 */
export function requestFields(event: {
	request: Request;
	route: { id: string | null };
	getClientAddress: () => string;
	locals: { user?: { id: string } | null };
}) {
	let address: string | undefined;
	try {
		address = event.getClientAddress();
	} catch {
		// Building, or a request made inside the server, has none.
	}
	return {
		'http.request.method': event.request.method,
		'http.route': event.route.id ?? undefined,
		'client.address': address,
		'user_agent.original': event.request.headers.get('user-agent') ?? undefined,
		'user.id': event.locals.user?.id
	};
}
