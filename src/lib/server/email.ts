import nodemailer, { type Transporter } from 'nodemailer';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
	SMTP_CA_FILE,
	SMTP_FROM,
	SMTP_HELO_NAME,
	SMTP_HOST,
	SMTP_PASSWORD,
	SMTP_PASSWORD_FILE,
	SMTP_PORT,
	SMTP_SECURITY,
	SMTP_USERNAME,
	SITE_URL
} from '$app/env/private';
import type { PoolClient } from 'pg';
import { db, pool, type Reader } from './db/index.ts';
import { emailMessage, integration, operator, user } from './db/schema/index.ts';
import {
	EMAIL_CHANNEL,
	NOTICE_SENDS_FOR,
	type Business,
	type Notice,
	type Person
} from './notices.js';
import { eitherOf } from './secret-file.ts';

/**
 * EMAIL, by SMTP to the relay SMTP_HOST names, from SMTP_FROM. Every provider
 * and every mail server takes mail by SMTP, and every self-hosted application of
 * this kind sends it that way, to a relay the operator chooses: whatever is
 * behind the relay is the operator's, and reckon is tied to none. The settings
 * are the ones those applications converge on (src/env.ts).
 *
 * A message is a row of email_message, written in the transaction that makes
 * the change it tells of (tell, below), so it is sent if and only if that change
 * is kept, and a request never waits on mail. The server sends it as soon as
 * the transaction commits -- Postgres tells it, on a channel of the same name
 * -- and looks again every minute for one to try again. A failure the relay
 * calls temporary is tried later each time until the message's send_by passes;
 * one it calls permanent, and a message past its send_by, is given up on. What
 * a message said is kept until then and no longer; a row is deleted after 90
 * days.
 *
 * TLS is required unless SMTP_SECURITY says none, the relay's certificate is
 * always checked, and never at less than TLS 1.2 (RFC 8314, RFC 8997): a relay
 * that does not offer STARTTLS is not sent to in the clear instead. Without TLS,
 * a password is never sent anywhere but to this machine, and mail to another
 * is said in the log at every start.
 */

/** The relay's settings, as src/env.ts reads them. */
export type RelaySettings = {
	host: string;
	port?: number;
	security: 'starttls' | 'tls' | 'none';
	username?: string;
	password?: string;
	/** The certificate authorities to trust for it, in place of the system's. */
	ca?: string;
	heloName?: string;
};

/** Whether a host is this machine, where mail crosses no network. */
export const isLoopback = (host: string) =>
	/^localhost$/i.test(host) || host === '::1' || host === '[::1]' || /^127\./.test(host);

/** What nodemailer is given, or why the settings cannot be used. */
export function relayOptions(r: RelaySettings) {
	if ((r.username === undefined) !== (r.password === undefined))
		throw new Error('SMTP_USERNAME and SMTP_PASSWORD go together: set both, or neither.');
	if (r.security === 'none' && r.username !== undefined && !isLoopback(r.host))
		throw new Error(
			`SMTP_SECURITY is none, so the password would cross the network to ${r.host} in the clear. ` +
				'Use starttls or tls, or a relay on this machine.'
		);
	return {
		host: r.host.replace(/^\[(.*)\]$/, '$1'),
		port: r.port ?? (r.security === 'tls' ? 465 : 587),
		secure: r.security === 'tls',
		// STARTTLS or nothing: a relay that does not offer it is not sent to.
		requireTLS: r.security === 'starttls',
		ignoreTLS: r.security === 'none',
		// Signed in to whenever there is someone to sign in as, even where the
		// relay did not offer to: a login quietly skipped is a setting that only
		// seems to work.
		auth: r.username !== undefined ? { user: r.username, pass: r.password! } : undefined,
		forceAuth: r.username !== undefined,
		name: r.heloName,
		tls: { minVersion: 'TLSv1.2' as const, ...(r.ca !== undefined && { ca: r.ca }) },
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 30_000
	};
}

/** Seconds before the next try, after this many: later each time, then hourly. */
export const AGAIN_AFTER = [60, 300, 900, 3600] as const;
export const againAfter = (tries: number) => AGAIN_AFTER[tries - 1] ?? 3600;

/** How long a row is kept, sent or not. */
const KEPT = sql`interval '90 days'`;
/** How long a sender holds a message it is sending before another may. */
const HELD = sql`interval '2 minutes'`;

/** The relay, and the address it is sent as. */
type Relay = { transport: Transporter; from: string };
/** The business a message is from, and where a reply goes. */
type Sender = { name: string; email: string | null } | undefined;

let relay: (Relay & { host: string }) | null | undefined;

/**
 * The relay and the address to send from, or null when SMTP_HOST is unset.
 * Made on first use; the server makes it as it starts, so a setting it
 * refuses stops it there.
 */
export function mailer() {
	if (relay !== undefined) return relay;
	const password = eitherOf('SMTP_PASSWORD', SMTP_PASSWORD, SMTP_PASSWORD_FILE);
	if (SMTP_HOST === undefined) {
		const stray = Object.entries({ SMTP_FROM, SMTP_USERNAME, SMTP_PASSWORD: password })
			.filter(([, v]) => v !== undefined)
			.map(([k]) => k);
		if (stray.length)
			throw new Error(
				`${stray.join(' and ')} ${stray.length > 1 ? 'are' : 'is'} set but SMTP_HOST is not.`
			);
		return (relay = null);
	}
	if (SMTP_FROM === undefined)
		throw new Error('SMTP_HOST is set but SMTP_FROM is not: say which address reckon sends as.');
	const options = relayOptions({
		host: SMTP_HOST,
		port: SMTP_PORT,
		security: SMTP_SECURITY,
		username: SMTP_USERNAME,
		password,
		ca: SMTP_CA_FILE,
		heloName: SMTP_HELO_NAME
	});
	return (relay = {
		transport: nodemailer.createTransport(options),
		from: SMTP_FROM,
		host: options.host
	});
}

/** The person and the business, as a notice speaks of them. */
async function whoAndWhose(tx: Reader, userId: string) {
	const [[person], [business]] = await Promise.all([
		tx
			.select({
				name: user.name,
				email: user.email,
				timezone: user.timezone,
				locale: user.locale
			})
			.from(user)
			.where(eq(user.id, userId)),
		tx
			.select({
				tradingName: operator.tradingName,
				shortName: operator.shortName,
				email: operator.email,
				phone: operator.phone,
				timezone: operator.timezone,
				locale: operator.locale
			})
			.from(operator)
			.limit(1)
	]);
	return {
		person: person satisfies Person | undefined,
		business: (business ?? {}) satisfies Business
	};
}

/**
 * Tells someone of something done to their sign-in, by email, once the
 * transaction it is called in commits (#lib/server/notices). A notice is worth
 * sending for a week; one carrying a link, only until the link stops working.
 */
export async function tell(
	tx: Reader,
	userId: string,
	notice: (person: Person, business: Business) => Notice,
	sendBy?: Date
): Promise<void> {
	const { person, business } = await whoAndWhose(tx, userId);
	if (!person) return;
	const { kind, to, subject, body } = notice(person, business);
	await tx.insert(emailMessage).values({
		kind,
		userId,
		toAddress: to,
		subject,
		body,
		sendBy: sendBy ?? sql`now() + ${NOTICE_SENDS_FOR}::interval`
	});
	// Delivered when the transaction commits, and not at all if it does not.
	await tx.execute(sql`select pg_notify(${EMAIL_CHANNEL}, '')`);
}

/** The Message-ID a message goes with, the same on every try. */
const messageId = (id: string, from: string) => `<${id}@${from.slice(from.lastIndexOf('@') + 1)}>`;

let sending = false;
let again = false;

/** Sends whatever is due, one batch after another until nothing is. */
export async function sendDue(): Promise<void> {
	if (sending) {
		again = true;
		return;
	}
	sending = true;
	try {
		do {
			again = false;
			await db.delete(emailMessage).where(lt(emailMessage.createdAt, sql`now() - ${KEPT}`));
			await db
				.update(emailMessage)
				.set({
					gaveUpAt: sql`now()`,
					body: null,
					claimedUntil: null,
					lastError: sql`coalesce(${emailMessage.lastError}, 'never sent: no relay was set')`
				})
				.where(
					and(
						isNull(emailMessage.sentAt),
						isNull(emailMessage.gaveUpAt),
						lt(emailMessage.sendBy, sql`now()`)
					)
				);
			const relay = mailer();
			if (!relay) return;
			// Held while it is sent, so a second server on the same database --
			// there may be one -- never sends it too.
			const due = await db.execute<{
				id: string;
				to_address: string;
				subject: string;
				body: string;
				tries: number;
			}>(sql`
				update ${emailMessage} set claimed_until = now() + ${HELD}, tries = tries + 1
				 where id in (select id from ${emailMessage}
				               where sent_at is null and gave_up_at is null and next_try_at <= now()
				                 and (claimed_until is null or claimed_until < now())
				               order by next_try_at limit 10 for update skip locked)
				returning id, to_address, subject, body, tries`);
			if (!due.rows.length) return;
			const [business] = await db
				.select({ name: operator.tradingName, email: operator.email })
				.from(operator)
				.limit(1);
			for (const m of due.rows) await sendOne(relay, m, business);
			again = true;
		} while (again);
	} finally {
		sending = false;
	}
}

/** One message as it goes: from the business, replies to it, and marked as a machine's. */
const sent = (
	relay: Relay,
	business: Sender,
	m: { id: string; to: string; subject: string; text: string }
) =>
	relay.transport.sendMail({
		from: { name: business?.name ?? 'reckon', address: relay.from },
		to: m.to,
		replyTo: business?.email ?? undefined,
		subject: m.subject,
		text: m.text,
		messageId: messageId(m.id, relay.from),
		// RFC 3834: sent by a machine, so an out-of-office reply is not sent back.
		headers: { 'Auto-Submitted': 'auto-generated' }
	});

/** What the relay said, or why it could not be asked, short enough to keep. */
const saidBy = (e: unknown) => {
	const error = e as Error & { response?: string };
	return (error.response ?? error.message ?? String(e)).slice(0, 500);
};

/** The relay took something: Settings says when it last did. */
const proven = (relay: Relay) =>
	db
		.insert(integration)
		.values({ name: 'email', connected: true, detail: relay.from, checkedAt: sql`now()` })
		.onConflictDoUpdate({
			target: integration.name,
			set: { connected: true, detail: relay.from, checkedAt: sql`now()` }
		});

async function sendOne(
	relay: Relay,
	m: { id: string; to_address: string; subject: string; body: string; tries: number },
	business: Sender
) {
	const done = (set: PgUpdateSetSource<typeof emailMessage>) =>
		db
			.update(emailMessage)
			.set({ claimedUntil: null, ...set })
			.where(eq(emailMessage.id, m.id));
	try {
		await sent(relay, business, { id: m.id, to: m.to_address, subject: m.subject, text: m.body });
		await done({ sentAt: sql`now()`, body: null, lastError: null });
		await proven(relay);
	} catch (e) {
		const permanent = (e as { permanent?: boolean }).permanent === true;
		const said = saidBy(e);
		if (permanent) await done({ gaveUpAt: sql`now()`, body: null, lastError: said });
		else
			await done({
				nextTryAt: sql`now() + ${sql.raw(`interval '${againAfter(m.tries)} seconds'`)}`,
				lastError: said
			});
		console.warn(
			`An email (${m.id}) was not sent${permanent ? ', and will not be' : ', and will be tried again'}: ${said}`
		);
	}
}

/**
 * Sends a test, now, to whoever asked for it on Settings, and answers with what
 * the relay said: not through email_message, since the point is to hear back.
 */
export async function sendTest(to: { name: string; email: string }) {
	const relay = mailer();
	if (!relay)
		return { sent: false as const, said: 'SMTP_HOST is unset, so reckon sends no email.' };
	const [business] = await db
		.select({ name: operator.tradingName, email: operator.email })
		.from(operator)
		.limit(1);
	try {
		await sent(relay, business, {
			id: crypto.randomUUID(),
			to: to.email,
			subject: `${business?.name ?? 'reckon'}: a test of email`,
			text: [
				`Hello ${to.name},`,
				`You asked for this on Settings, under Integrations. It reached you, so reckon can send email: it goes to ${relay.host}, as ${relay.from}.`,
				'There is nothing to do.'
			].join('\n\n')
		});
		await proven(relay);
		return { sent: true as const, to: to.email };
	} catch (e) {
		return { sent: false as const, said: saidBy(e) };
	}
}

/**
 * Starts sending: now, whenever Postgres says a message was written, and every
 * minute for one to try again. Once, as the server starts, which first says in
 * its log whether the relay answers and takes its sign-in. A relay that does
 * not is no reason not to start: what is written waits for it.
 */
export function startSending(): void {
	const relay = mailer();
	if (!relay)
		console.warn(
			'SMTP_HOST is unset: reckon sends no email, and nobody can be invited. A notice waits a week for one to be set.'
		);
	else if (!SITE_URL)
		console.warn(
			'SITE_URL is unset: reckon has no address to build a link from, so nobody can be invited or have their password reset by email.'
		);
	else {
		// Chosen, and allowed, but never quietly (RFC 8314 §5.2).
		if (SMTP_SECURITY === 'none' && !isLoopback(relay.host))
			console.warn(
				`SMTP_SECURITY=none: email to ${relay.host} crosses the network unencrypted, readable and changeable on the way.`
			);
		relay.transport
			.verify()
			.then(() => console.log(`Email goes to ${relay.host}, as ${relay.from}: it answers.`))
			.catch((e: Error & { response?: string }) =>
				console.warn(
					`Email goes to ${relay.host}, which does not answer as it should yet: ${(e.response ?? e.message).slice(0, 300)}`
				)
			);
	}
	// One connection is kept to hear on, so it is given back when the server
	// stops: adapter-node waits for nothing to be left running, and this would
	// be left running for ever.
	let stopping = false;
	let listening: PoolClient | null = null;
	const listen = async () => {
		if (stopping) return;
		try {
			const client = await pool.connect();
			listening = client;
			client.on('notification', () => void sendDue().catch(report));
			client.on('error', () => {
				listening = null;
				client.release(true);
				setTimeout(() => void listen(), 5000).unref();
			});
			await client.query(`listen ${EMAIL_CHANNEL}`);
		} catch (e) {
			report(e);
			setTimeout(() => void listen(), 5000).unref();
		}
	};
	void listen();
	setInterval(() => void sendDue().catch(report), 60_000).unref();
	process.once('sveltekit:shutdown', () => {
		stopping = true;
		listening?.release(true);
		listening = null;
		relay?.transport.close();
	});
	void sendDue().catch(report);
}

const report = (e: unknown) =>
	console.error('Sending email failed:', e instanceof Error ? e.message : e);
