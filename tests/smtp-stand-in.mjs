#!/usr/bin/env node
/**
 * A stand-in for a mail relay, for the checks to send to without one: it takes
 * mail by SMTP on loopback, as a relay on the same machine would, and keeps it
 * for a check to read back over HTTP.
 *
 *   node tests/smtp-stand-in.mjs [smtp-port] [http-port]    # 2525 and 2526 unless given
 *
 *   GET    /messages   what it has taken, oldest first, as JSON
 *   DELETE /messages   forgets it
 *
 * Two kinds of address answer as a relay that is having trouble would: one
 * whose local part starts later- is refused as temporary (451) the first time
 * it is tried and taken after, and one starting never- is refused for good (550).
 */
import { createServer as createTcpServer } from 'node:net';
import { createServer } from 'node:http';

const [smtpPort, httpPort] = [Number(process.argv[2] ?? 2525), Number(process.argv[3] ?? 2526)];

/** @type {{ from: string, to: string[], data: string, at: string }[]} */
let taken = [];
/** Addresses already refused once, which are taken the next time. */
const deferred = new Set();

createTcpServer((socket) => {
	socket.setEncoding('utf8');
	const say = (/** @type {string} */ line) => socket.write(`${line}\r\n`);
	/** @type {{ from: string, to: string[] }} */
	let envelope = { from: '', to: [] };
	let reading = false;
	let data = '';
	let pending = '';
	say('220 stand-in ESMTP');
	socket.on('data', (/** @type {string} */ chunk) => {
		pending += chunk;
		let end;
		while ((end = pending.indexOf('\r\n')) !== -1) {
			const line = pending.slice(0, end);
			pending = pending.slice(end + 2);
			if (reading) {
				if (line === '.') {
					reading = false;
					taken.push({ ...envelope, data, at: new Date().toISOString() });
					envelope = { from: '', to: [] };
					data = '';
					say('250 taken');
				} else data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
				continue;
			}
			const [verb] = line.split(/[ :]/, 1);
			const address = /<([^>]*)>/.exec(line)?.[1] ?? '';
			switch (verb.toUpperCase()) {
				case 'EHLO':
					say('250-stand-in');
					say('250 8BITMIME');
					break;
				case 'HELO':
					say('250 stand-in');
					break;
				case 'MAIL':
					envelope = { from: address, to: [] };
					say('250 ok');
					break;
				case 'RCPT':
					if (address.startsWith('never-')) say('550 5.1.1 no such mailbox');
					else if (address.startsWith('later-') && !deferred.has(address)) {
						deferred.add(address);
						say('451 4.3.0 try again later');
					} else {
						envelope.to.push(address);
						say('250 ok');
					}
					break;
				case 'DATA':
					if (!envelope.to.length) say('554 no valid recipients');
					else {
						reading = true;
						say('354 go ahead');
					}
					break;
				case 'RSET':
					envelope = { from: '', to: [] };
					say('250 ok');
					break;
				case 'NOOP':
					say('250 ok');
					break;
				case 'QUIT':
					say('221 bye');
					socket.end();
					break;
				default:
					say('502 not here');
			}
		}
	});
	socket.on('error', () => {});
}).listen(smtpPort, '127.0.0.1');

createServer((req, res) => {
	if (req.url !== '/messages') return res.writeHead(404).end();
	if (req.method === 'DELETE') taken = [];
	res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(taken));
}).listen(httpPort, '127.0.0.1', () =>
	console.log(`  mail relay stand-in on ${smtpPort}, read back on ${httpPort}`)
);
