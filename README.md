# reckon

**Jesus is Lord.**

Invoicing and time tracking, self-hosted, for a small trade business. Given
freely, and built so that anybody could run it — nothing about one operator is a
constant in the code.

To reckon up an account is to settle it, and settling is the point: a ledger, an
invoice and a timesheet that disagree are three problems rather than one system.

## Every client here is invented

The seed, the guard suite, the schema's comments and the docs describe
Kestrel Field Services, a business that does not exist, and its clients,
who do not either. No real client's records are in this repository, in any
commit: they are rows in the operator's own database. Addresses are public
places, chosen because CDTFA answers for them, so every rate and district in the
seed is a real answer for a real address.

**The reasoning is kept beside the rule.** The schema says why each rule
exists, table by table, and `tests/db/constraints.sql` proves it both ways,
against an invented case.

## Where things are

reckon is a SvelteKit project with Drizzle, laid out as both lay one out.

|                                 |                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/db/schema/`     | the schema, in TypeScript, a file per area, with every table's reasons beside it                                |
| `drizzle/`                      | the schema as applied SQL: generated from the above, and hand-written migrations for whatever Drizzle can't say |
| `src/lib/server/db/migrate.ts`  | brings a database up to date as its owner, and checks, as the server starts, that it is                         |
| `src/lib/server/valuation/`     | what an hour bills, what it pays, what a retainer covers, and the tax split — exact decimals, tested            |
| `src/lib/server/log.ts`         | the log: one JSON line for each thing the server records — see [Logging](#logging)                              |
| `tests/db/constraints.sql`      | proves the guards, both ways                                                                                    |
| `tests/`                        | the behaviour checks, which drive the built app in a browser against an invented business                       |
| `scripts/`                      | the commands: adding people, refreshing tax rates, migrating, proving the guards, printing, making a release    |
| `docs/schema/*.drawio`          | the data model: an overview and eight clusters                                                                  |
| `docs/schema/regenerate.py`     | lays the diagrams out from one definition of the tables; overwrites hand edits                                  |
| `docs/schema/make-printable.py` | reads the printed reference's tables and notes out of the diagrams, as data                                     |
| `docs/schema-reference.typ`     | the printed reference, which reads that data from `docs/schema/reference.json`                                  |
| `third_party/press/`            | press, the Typst library, fonts and tools the documents are set in, installed from its release                  |

## The database

```bash
npm run db:test                              a scratch database, brought up to date, every guard proven, dropped
npm run db:drift                             the migrations match the schema: generated into a copy, connecting to nothing
npm run db:migrate                           bring the database up to date: the one PGDATABASE or DATABASE_URL names
npm run db:seed                              the invented business the checks run against, into that database
npm run db:generate -- --name what-changed   the migration for a change to the schema
```

**The database is brought up to date before the server starts**, as its own
step: `npm run db:migrate`, or `node scripts/migrate.mjs` in a release, applies
every migration in `drizzle/` the database has not seen, by Drizzle's migrator,
those waiting in one transaction, so one that fails leaves it as it was. The
server only checks: while a migration beside it is waiting it does not start,
so nothing is ever served from a database the code does not expect.

Where the database can hold a rule about what may be stored rather than
trusting the application to remember it, it does — and every guard is tested
both ways, because one that also blocks ordinary use is a bug rather than a
guard. What a stored row is _worth_ is the application's: it is arithmetic, and
it is done once, in `#lib/server/valuation`.

The schema is changed in `src/lib/server/db/schema/`, and the migration
written from it with `npm run db:generate`. What Drizzle cannot express — the
triggers that freeze a sent invoice and keep the history, one foreign key, the
roles every operator starts with — is in the hand-written
`drizzle/0001_integrity.sql`, with its invoice guards made to hold in
`0002_sent_invoices_hold.sql` and a file described in the history rather than
copied into it in `0003_history_describes_binary.sql`. A new one starts as
`npm run db:generate -- --custom --name what-changed`.

The commands connect the way every other Postgres client does — `PGHOST`,
`PGPORT`, `PGUSER`, `PGPASSWORD` — and add nothing of their own. Whoever owns a
database owns everything a migration makes; `npm run db:migrate`, run by a role
that may become the owner — `postgres`, say — acts as the owner, and run by one
that may not, stops before anything is applied.

Afterwards nothing in `public` or `drizzle` — where the record of applied
migrations is kept — may be owned by anyone else, or it stops. An object made by
another role is invisible to an application connected as the owner, and that
surfaces as a permission error from whichever query reaches it first — a long
way from the cause.

**The server owns nothing.** The owner can change any table and switch off any
trigger — the ones that freeze a sent invoice and keep the history among them —
so the server connects as a role that cannot: granted rows and reading the
record of migrations, and nothing more (ASVS 5.0 13.2.2: "accounts assigned the
least necessary privileges"; OWASP's Database Security Cheat Sheet: the
application's account "should not be the owner of the database"). Two roles,
then, each signed in over the unix socket as the system user of the same name,
so the server's user can never be the owner:

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| `reckon_owner` | owns the database; migrates it before each start, and dumps and restores it |
| `reckon`       | the server: reads and writes rows, and owns nothing                         |

Once, as `postgres`, the roles and the database:

```sql
CREATE ROLE reckon_owner LOGIN;
CREATE ROLE reckon LOGIN;
CREATE DATABASE reckon OWNER reckon_owner;
```

Then `node scripts/migrate.mjs` as `reckon_owner`, and once more as `postgres`,
in the database, what the server may do:

```sql
GRANT USAGE ON SCHEMA public, drizzle TO reckon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO reckon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO reckon;
GRANT SELECT ON drizzle.__drizzle_migrations TO reckon;
-- and every table and sequence a later migration makes, as the owner makes it
ALTER DEFAULT PRIVILEGES FOR ROLE reckon_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO reckon;
ALTER DEFAULT PRIVILEGES FOR ROLE reckon_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO reckon;
```

`FOR ROLE` is what makes the last two hold whoever runs them: without it they
cover what `postgres` makes, and the next migration's tables are not the
server's to use.

**Or the server migrates as it starts.** `MIGRATE_ON_START=true` is for a host
with no step before a start: the server connects as the owner and brings the
database up to date before it answers, as Gitea and Synapse do — and can then
change any table. Connected as a role that may not, it says so and does not
start. A database the server has owned so far is split once, as `postgres`, in
it, then granted as above:

```sql
CREATE ROLE reckon_owner LOGIN;
ALTER DATABASE reckon OWNER TO reckon_owner;
REASSIGN OWNED BY reckon TO reckon_owner;
```

Which roles there are is the host's to set; reckon names none, and these are
only what this README calls them. CI runs the server as `reckon`, owning
nothing, so anything that would need to own a table fails there first.

## The application

```bash
/                what is owed, what is ready to send, and what needs a decision
/timesheet       the running timers and today's entries
/timesheet/all   every entry in a month
/clients         every client; /clients/:id is one, with its sites and agreements
/invoices        drafts, sent and paid
/settings        everything about the operator
/invoice/:token  one sent invoice, for the client: opens without signing in
```

A draft is sent from its own Send screen, which dates it, gives it its due date
and its link, and hands the link to the phone's share sheet or the clipboard.
The link is the only thing that opens a page without signing in, and it opens
that invoice alone: what it asks for, what is still owed on it, and who it is
from. Nothing of how the work was done is on it. Paid is not a status: an
invoice is paid when what is owed on it, less payments and credit notes, comes
to nothing.

Timers run in `localStorage`, several at once — one person can be on a job
while another is on something else, and one phone tracks both. They survive a
refresh, because a timer a reload silently ends is worse than no timer: you find
out hours later. Nothing reaches `time_entry` until one stops. Stopping writes
its entry to the same queue as everything else, dated the day it started and
carrying the timer's own id as the entry's `client_uuid` — and the timer is let
go only once that write has committed.

The queue is in IndexedDB, and nothing in it is thrown away. An entry leaves
when the server has it or when someone discards it by hand. One the server
refuses for good — it names a service deleted after it was recorded offline —
is kept with the server's reason, shown on Time as not saved, and fixed or
discarded there.

`DELETE /api/time/:id` removes an entry. One an invoice was built from cannot be
removed: `invoice_line.time_entry_id` is `ON DELETE RESTRICT`. What is removed
is written to `record_history` in full, because a time entry is what an invoice
is built from.

**A calendar date is a string, `2026-03-14`, all the way through.** A JS
`Date` is a moment, and a date read into one at UTC midnight renders as the day
before west of Greenwich. So the schema's date columns say `mode: 'string'`,
and the client turns off the driver's own parsing of `DATE`, which a date
computed in SQL would otherwise go through.

Mobile first, because a timer is used standing in a server room: one column, a
thumb-reach tab bar, and a sidebar only once there is room for one.

**One accent colour, and it is the operator's.** `operator.accent_colour`
replaces reckon's muted default when it is set, and the logo is served from the
same row; green, amber and red are kept for state and never for decoration.
With no operator saved, the shell is titled reckon.

## Signing in

[Better Auth](https://www.better-auth.com), over the application's own
database. Sessions are rows in `session`, not stateless tokens. One server, one
database, and every page reads it anyway — so a stateless token would save no
round trip and would cost the thing that matters: a session that can be revoked
now.

**Someone stays signed in, as GitHub keeps them:** until two weeks without use,
each use carrying it on. ASVS 5.0 leaves the limits to the risk, and GitHub
keeps people signed in and checks where the harm is; so the checks are there
instead: a lost phone's passkeys are ended on Team, someone deactivated is
signed out everywhere as it is done, and signing in again is one touch of a
passkey. Two weeks is over 20 hours, so WCAG 2.2.1 asks no warning before it.
An overall limit besides, however much a session is used (NIST SP 800-63B-4
§2.2.3, ASVS 5.0 7.3.2), is Better Auth's to give, and it has none yet
([better-auth/better-auth#10405](https://github.com/better-auth/better-auth/issues/10405)).

**Everyone signs in with a passkey, and there are no passwords.** A passkey is
a key pair a phone, a computer or a security key keeps; the fingerprint, face,
PIN or screen lock that unlocks it is checked there, and only its public half is
here. Each one must say it checked who was holding it, made or used, or it is
refused: a sign-in is then two factors, AAL2 (NIST SP 800-63B-4), which an
account holding someone's pay needs (SP 800-63A-4 §5.2). A passkey is tied to
this site, so a look-alike site can't use it, and nothing a mailbox holds signs
anyone in. Passkeys need `SITE_URL`: it is the site each one is made for, and a
host name, since WebAuthn takes no IP address.

**The sign-in page** offers the passkeys the browser holds as the email field is
filled (autofill), and **Sign in with a passkey** opens the browser's own dialog,
with a phone's QR code and a security key besides. Nothing about the address
typed is looked up. Inside an app's own browser, where passkeys can't be used,
the page says to open it in Chrome or Safari. Signed in with a passkey from
another device, someone is offered one for the one they are on.

**There is no sign-up.** Someone with Full adds people on Team, and each is
emailed an invitation: a link to make their passkey with. The first person is
added from the command line, and given theirs there:

```bash
node scripts/user.mjs add you@example.com "Your Name" --role Partner
node scripts/user.mjs invite you@example.com
node scripts/user.mjs list
```

`add` prints the person's invitation link, to open on the phone or computer they
will use; `invite` gives a link again, an invitation for someone yet to make a
passkey or, for someone who can't sign in, a new link. Someone with Full sends a
new link from Team the same way. Recovery is so by design: the business knows
its people (§4.2.1, recovery through someone who can vouch for them), and the
one with Full who has lost everything has the server.

**A new link adds a passkey, and ends none**: someone who can't sign in may have
left their phone at home, not lost it, and recovery is binding a new
authenticator (§4.2), not invalidating the old. Team asks, every time one is
sent, whether a phone or computer of theirs is lost or stolen, with no answer
chosen; if one is, every passkey they have ends and they are signed out
everywhere as it goes, since a lost authenticator is taken as compromised and
invalidated promptly (§4.3), and waiting for the link to be used would leave
whoever has the phone signed in. **End their passkeys**, on Team, does the same
with no link, for someone who reports one lost while still able to sign in, and
`node scripts/user.mjs end <email>` does it from the command line. A person's
**Passkeys** tab on Team lists theirs as Your profile does, and ends one alone,
signing them out everywhere while the rest keep working. Either way they are
told by email (§4.5).

**A link** is good once, for an hour: making a passkey with it is a way in, so it
lasts as a credential handed over does. Its code is after the `#`, which a
browser never sends, so no server, log or `Referer` sees it, and only a hash of
it is kept; a code that is not one to use, whatever the reason, gets the same
answer, and a network that tries ten in fifteen minutes waits. Team says when one
went and until when it works, and one that lapses is sent again from there. The
link's page asks the passkey plugin for the ceremony itself, server to server,
naming the link by its id, so the code goes no further. Using it proves the
address it went to is theirs, signs them out everywhere else (OWASP's Passkey
Security Cheat Sheet: "after recovery, rotate sessions"), and signs them in with
the new passkey.

**Your profile** lists each passkey: its name, where it is kept, when it was made,
and when and from which browser it was last used. A new one is named for its
passkey manager where it says which ("Google Password Manager"), or else for the
browser it was made on ("Safari on iPhone"): Apple's never say. It renames and
removes them, and adds another, one for each device, or one in a passkey manager
that syncs between them; with only one, it says to
add another, as NIST and OWASP both advise, so losing one device doesn't lock
them out. Someone with Full keeps at least one. Adding or removing one tells
them by email (§4.1.2.1, §4.5), with whom to contact if it was not them.

Using a link also proves the address it went to is theirs, and Team says whose
are confirmed. Anyone else confirms theirs from Your profile, by a link sent
there.

A new address for someone who has signed in waits until it is proven theirs:
the one they have stays theirs until they use the link emailed to the new one,
which then becomes theirs, confirmed (NIST SP 800-63B-4 §4.2.1.2). The address
they have is told when the change is asked for — who asked, and for what — with
no link in it. Team shows the change Pending, or Expired once its link lapses,
with Send again and Cancel change; their own profile says where the link went.
The link's page asks before it changes anything, so a mail scanner opening it
changes nothing. Someone yet to accept their invitation changes at once and is
sent it again, at the new address; someone deactivated changes at once,
unconfirmed, and nobody is emailed.

Each person has an access level, apart from the role they are paid in. **Full**
reaches everything, and is the only level that bills or pays. **Field** reaches
the work someone does and what they are paid for it: their own time and trips,
team work they were on, lines added to a draft, the clients and sites they work
at, and their own pay, to read. Someone added at the command line has Field
unless `--full` is given; the first person has Full whatever is said, since the
database keeps someone active on Full. After that, everything about a person is
changed on Team, by someone with Full: their name and email, their access, the
role they are paid as, a new link, and whether they sign in. Deactivated, they
can't, and aren't offered work; everything they did is kept, and they can be
reactivated. Team also says when each person last signed in, and who is
Invited, or whose invitation expired unused.

**Team is where access is reviewed.** Each person's row says when they last
signed in, their passkeys and where each is kept, and how many sessions they
have open; under the list is when access was last marked reviewed, and by whom.
Someone with Full looks, then marks it, and that is a row of the security log
(SOC 2 CC6.2 and CC6.3; PCI DSS 7.2.4 asks every six months). Nothing reminds
anyone: ASVS 5.0 asks for no review at all, and the date is there to see.

**Better Auth's routes are mounted under `/api/auth`**, as its SvelteKit guide
has it, and only where `SITE_URL` is set: that is the only base URL Better Auth
is given, never one taken from a request. `src/lib/server/auth-paths.ts` lists
every route it has as open or closed, and a unit test fails on any it doesn't
list, so a route a new release adds is looked at before it is served. Open are
the four a passkey's ceremonies need; every closed one answers 404. Listing,
naming and removing passkeys, and signing out, are form actions that call it
directly. Two routes have a parameter in their path, which `disabledPaths`
can't name (better-auth/better-auth#4843). Until `enabledPaths` lands
(better-auth/better-auth#11078) they are served, and do nothing here: the reset
route hands nothing to another origin and reckon issues no token for it, and the
social callback, with no provider configured, signs nobody in.
`tests/auth-routes-check.mjs` holds them to that. Its origin and CSRF checks are
on outright, since left unsaid Better Auth turns both off wherever `NODE_ENV` is
`test` or `TEST` is set. Its rate limiter counts in the database, so a restart
forgives nothing.

The cookie is the session's token signed with `BETTER_AUTH_SECRET`, so a copy
of the table lets nobody in without the secret as well.

**`BETTER_AUTH_SECRET` must be set when the server runs**, 32 characters at
least, or it will not start, under `npm run dev` too. Left to itself Better Auth would sign with a default
that is printed in its own source.

**A secret can be given as a file instead.** `BETTER_AUTH_SECRET_FILE` and
`GOOGLE_MAPS_API_KEY_FILE` name a file holding the secret, in place of the
secret itself, and the database's password is libpq's own password file
(`PGPASSFILE`, else `~/.pgpass`). An environment is inherited by every process
started under it, and a systemd unit's `Environment=` can be read over D-Bus,
which is why systemd calls environment variables "not suitable for passing
secrets"; a file is read only by whoever may read it. The file is read once, at
start; the whitespace around what it holds is not part of the secret, and an
empty file is refused. Set one of a secret and its file, never both, or the
server will not start. Under systemd, a credential and its path:

```ini
LoadCredential=better-auth-secret:/etc/reckon/better-auth-secret
Environment=BETTER_AUTH_SECRET_FILE=%d/better-auth-secret
```

**The session cookie is `Secure`** unless `SECURE_COOKIES=false`, so a browser
only ever sends it over https. Turning that off is for a proxy that serves plain
http, and what it costs is the session token crossing that network in the
clear — the server says so in its log every time it starts.

## Email

reckon sends email by SMTP to a relay the environment names: a provider's —
Amazon SES, Postmark, SendGrid, Mailgun, Fastmail, Gmail with an app password —
or a mail server on the same machine or network that passes it on. Every
provider and every mail server takes mail that way, so whatever is behind the
relay is the operator's choice, and nothing in reckon is tied to one. Unset, it
sends nothing.

It sends an invitation to someone added on Team, a new link to make a passkey
with, sent from Team, a link to confirm an address, asked for on Your profile,
and a link to a new address asked for on Team, with word to the old one — each
built from `SITE_URL`, never from the address a request came in on (OWASP's
Forgot Password Cheat Sheet), and sent only while its link still works. And it
tells a person whenever a passkey is added to or removed from their account,
saying which, when, in their own zone, from which browser, and who to ask if it
was not them. Without `SMTP_HOST` and `SITE_URL` nobody can be invited by email,
and Team says which is missing.

Every message goes as plain text and as HTML, the text first (RFC 2046), both
laid out from the same words by one layout written by hand
(`src/lib/server/email-layout.js`): the business's logo — a PNG or JPEG,
carried inside the message rather than fetched, its name in its place
otherwise — a heading, the words, a button in the business's accent colour with
its link spelled out under it, and a footer saying how to reach the business.
Tables and inline styles, so classic Outlook for Windows draws it as the rest
do; dark colours where a mail program asks for them; the button's words at
4.5:1 whatever the accent. The templates are code, not settings.

Each message is a row of `email_message`, written in the same transaction as the
change it tells of, so it is sent if and only if that change is kept, and the
request that made it never waits on mail. The server sends it as soon as the
transaction commits. A message the relay puts off is tried again a minute
later, then five, fifteen and every hour after, for a week; one it refuses for
good is given up on at once. What a message said is kept only until then, and a
row is deleted after 90 days.

```bash
SMTP_HOST=email-smtp.us-west-2.amazonaws.com   # a provider's relay
SMTP_USERNAME=AKIA…                            # its SMTP credentials
SMTP_PASSWORD_FILE=/etc/reckon/smtp-password
SMTP_FROM=reckon@example.com                   # an address it may send as
```

```bash
SMTP_HOST=127.0.0.1  SMTP_PORT=25  SMTP_SECURITY=none   # Postfix on this machine
SMTP_FROM=reckon@example.com
```

```bash
SITE_URL=https://reckon.example.com   # where the links it emails go
```

**TLS is required unless `SMTP_SECURITY=none`.** `starttls`, the default, has
the relay upgrade the connection on 587, and a relay that does not offer to is
not sent to; `tls` speaks TLS from the first byte, on 465. The relay's
certificate is always checked, at TLS 1.2 or later; a relay whose certificate a
private authority issued — Proton Mail Bridge's, say — is trusted with
`SMTP_CA_FILE`, and there is no setting to leave it unchecked. `none` is for a
relay on this machine, where the mail crosses no network: to any other host the
server says so in its log at every start, and a password is never sent without
TLS except to this machine.

The port is anything the relay listens on, since clouds block the usual ones:
outbound 25 on AWS, Google Cloud and Azure; 25 and 465 on Hetzner; 25, 465 and
587 on DigitalOcean, where a provider's 2525 or 2587 still reaches.

When the server starts it says in its log whether the relay answers and takes
its sign-in. **Settings → Integrations** shows where email goes and as whom,
when the relay last took something, and the last message it would not take, with
what it said; **Send a test email** sends one to whoever pressed it and says
what the relay answered.

Messages go from the address `SMTP_FROM` names, under the business's trading
name, with replies to the business's own email, and say they were sent by a
machine (`Auto-Submitted: auto-generated`), so an out-of-office does not answer
them. Signing them (DKIM) and the domain's SPF and DMARC records are the
relay's and the domain's, not reckon's: a provider's setup guide says what to
add.

## Serving it

**A request's address is never configured.** The server reads its own from
each request — the `Host` header, over https — so the address a form is checked
against is always the one the browser used. A configured address can disagree
with that, and when it does every form post is refused as cross-site, sign-in
included. `SITE_URL` is only where the links reckon emails go, since an email
has no request to read one from; a request's `Host` never reaches one.

What that asks of whatever is in front of it:

|                                                                |               | set                                                            |
| -------------------------------------------------------------- | ------------- | -------------------------------------------------------------- |
| https, through a reverse proxy that passes `Host` through      | the default   | nothing                                                        |
| https, through one that puts the public name in another header |               | `HOST_HEADER`, e.g. `x-forwarded-host`                         |
| plain http, through a proxy                                    |               | `PROTOCOL_HEADER=x-forwarded-proto` and `SECURE_COOKIES=false` |
| plain http straight to the process, no proxy                   | not supported | —                                                              |

The last is SvelteKit's limit rather than reckon's. With nothing in the request
to say the scheme, adapter-node takes it to be https, and a form posted from an
http page reads as cross-site. The only way round that is building the address
into the artifact, which makes it one build per deployment.

**Behind any proxy, say where the visitor is.** The process has one client —
the proxy — so without `ADDRESS_HEADER` every visitor has the proxy's address:
Better Auth's rate limit and the wrong codes a link page counts become one
count for everyone, and every session records the proxy.
Name a header the proxy sets from the connection. One it overwrites, like an
`X-Real-IP` set from the connection's address, needs nothing else.
`X-Forwarded-For` is one a client can start, so it also needs `XFF_DEPTH`: the
number of proxies in front, 1 for one.

## Logging

**The server writes one JSON line for each thing it records**, on standard
output, where whatever runs it keeps it — journald, under a service unit
(`src/lib/server/log.ts`, by pino). JSON, so a line break inside a value is
written as `\n`, and nothing anyone types can begin a line of its own. Each line
has its `time`, in ISO 8601 and UTC, and its `level`. An event is named as
OWASP's Logging Vocabulary names it, in the field OWASP's own example calls
`event`; every other field has OpenTelemetry's name — `user.id`,
`client.address`, `user_agent.original`, `http.request.method`, `http.route`.

What is recorded, and where (ASVS 5.0 16.1.1):

|                                                       | where                             |                                                                                                                                 |
| ----------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `sys_startup`, `sys_shutdown`                         | the log                           | each start, once the database is checked; each stop, with why                                                                   |
| `sys_crash`                                           | the log                           | a start that failed, or an exception nothing caught; Node's own stack follows it                                                |
| an error nobody meant                                 | the log                           | with its `error.id`, the route and who asked; the person is shown the id and no more                                            |
| a value the database refused                          | the log                           | its code, table, constraint and column — never what was typed                                                                   |
| email, Google and the relay's settings                | the log                           | a message not sent, a lookup refused, a setting left unsafe                                                                     |
| Better Auth's own messages                            | the log                           | under `code.namespace` `better-auth`                                                                                            |
| every change to the business's records, and to people | `record_history`, in the database | who, when, what, and the save it was part of; written by the tables' own triggers alone, never changed, and kept with the books |
| each security event                                   | `security_event`, and the log     | below; each person sees theirs on Your profile, someone with Full everyone's on Team                                            |

Never written: a secret, a token, a cookie, a session id, a sign-in link or an
email's body. An object that carries one by name has it replaced with
`[kept out]`. The one line that is not JSON is adapter-node's own
`Listening on …` as it starts.

**The security log is every sign-in and every change to who can reach what**
(`src/lib/server/events.ts`): a row of `security_event` for people to read, and
a line of the log, its `event` the name below, `user.id` whom it was about and
`by.user.id` who did it where that was someone else. Your profile shows each
person theirs, and what they did to anyone else; Team shows someone with Full
everyone's, and each person's on their page. The database stamps each with its
own clock, never lets one change, and removes one only once it is a year old,
which the server does every day; someone in it is made inactive, never deleted.

|                                                              |                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `authn_login_success`                                        | signed in, with a passkey or with the first one a link made                            |
| `authn_login_fail`                                           | a passkey sign-in refused: one reckon doesn't know, a check failed, someone not active |
| `excess_rate_limit_exceeded`                                 | Better Auth's limit on its routes, or too many link codes tried from one network       |
| `session_logout`, `session_expired`                          | signed out; signed out everywhere, with why                                            |
| `authn_passkey_added`, `authn_passkey_removed`               | a passkey made, removed, or ended as lost or stolen                                    |
| `authn_link_issued`, `authn_link_used`, `authn_link_refused` | an invitation or other link sent or used; a code that was not one to use               |
| `user_created`, `user_updated`                               | someone added; their name, address or role changed — which, never what to              |
| `authz_change`                                               | their access changed, from and to                                                      |
| `user_archived`, `user_restored`                             | made inactive, or active again                                                         |
| `authz_fail`                                                 | refused for lack of access, by route — answered 403, or as not found                   |
| `access_reviewed`                                            | Team's access marked reviewed, by whoever looked                                       |

How long the log is kept, and copying it to another machine so that a breach
of this one cannot change it (16.4.3), are the host's: journald's settings, and
whatever ships it.

## A release

A release is one tarball, built by `npm run release` and published with its
provenance attested: the part of this repository that runs, at the same paths it
has here, with every package it uses bundled in, so a host needs Node and
nothing else.

|                   |                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build/`          | the application; `node build` runs it                                                                                                            |
| `drizzle/`        | the migrations, which `scripts/migrate.mjs` applies                                                                                              |
| `scripts/`        | `user.mjs`, which adds the first person and gives a link to make a passkey, and `migrate.mjs`, which brings the database up to date as its owner |
| `package.json`    | and `package-lock.json`: which version of each package is bundled                                                                                |
| `RELEASE`         | the version, the commit, and the Node it was built with                                                                                          |
| `MANIFEST.sha256` | every file's digest, so what is installed can be checked                                                                                         |

**Everything it runs is in the bundle, so it has no `node_modules/`.** What it
reaches outside itself is the host's own: Node, Postgres and the mail server.
Every package is a devDependency: adapter-node bundles everything but
`dependencies`, and a test fails if one appears there. Each command in
`scripts/` is bundled as `build/` is, into one file at the path it has here.

Run it from its own directory — a service unit's `WorkingDirectory` — since the
migrations are read from `drizzle/` there. A deploy is a backup of the database,
the release unpacked, `node scripts/migrate.mjs` run from it as the database's
owner, and the server restarted, which does not start on a database still
behind it.

## Environment

Everything the process needs, and nothing that belongs in the database.
[`src/env.ts`](src/env.ts) declares each variable with its default and
its check, and every one is read when the server starts rather than built in, so
the same artifact runs on any host with any values. A value that fails its check
stops the server at start with the reason.

[`.env.example`](.env.example) is the same list as a file, and is what to copy
to `.env` for local development, beside `vite.config.ts`. `npm run dev` reads it
there, and so do the commands and checks that reach the database
(`scripts/env.mjs`), under whatever the shell sets. **Nothing that differs from
one deployment to the next is assumed**: without a database or a secret, the
server and the commands stop and say which, in development too.

|                                  |                   |                                                                                                                                                                                                                                |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`             | **required**      | signs every session cookie; 32 characters at least, random — `openssl rand -hex 32`. Without it the server does not start, in development either. Changing it signs everybody out                                              |
| `BETTER_AUTH_SECRET_FILE`        | unset             | a file holding `BETTER_AUTH_SECRET`, in its place — see [Signing in](#signing-in)                                                                                                                                              |
| `SECURE_COOKIES`                 | `true`            | `false` only behind a proxy that serves plain http — see [Serving it](#serving-it)                                                                                                                                             |
| `PORT`                           | `3000`            |                                                                                                                                                                                                                                |
| `HOST`                           | `0.0.0.0`         | set it to `127.0.0.1` where a reverse proxy is the only route in, so the bind enforces that rather than convention                                                                                                             |
| `PROTOCOL_HEADER`, `HOST_HEADER` | unset             | read by adapter-node: the headers a proxy uses for the scheme and the public name, where it does not pass them as https and `Host` — see [Serving it](#serving-it)                                                             |
| `ADDRESS_HEADER`, `XFF_DEPTH`    | unset             | read by adapter-node: the header holding a visitor's address. **Needed behind any proxy** — unset, every visitor is the proxy — see [Serving it](#serving-it)                                                                  |
| `PGHOST`                         | where libpq looks | on Linux the unix socket `/var/run/postgresql`, which peer-authenticates rather than asking for a password; `/tmp` on macOS, `localhost` on Windows                                                                            |
| `PGUSER`, `PGPASSWORD`, `PGPORT` | unset             | who to connect as, its password and the port: the operating-system user, none, 5432                                                                                                                                            |
| `PGPASSFILE`                     | `~/.pgpass`       | libpq's password file, for a password in place of `PGPASSWORD`; passed over unless only its owner may read it                                                                                                                  |
| `PGDATABASE`                     | **required**      | which database, unless `DATABASE_URL` says: `reckon_dev`, say, in development. None is assumed                                                                                                                                 |
| `DATABASE_URL`                   | —                 | wins outright over `PGHOST`/`PGDATABASE`, for TCP, another machine, or a managed service                                                                                                                                       |
| `MIGRATE_ON_START`               | `false`           | `true` has the server bring the database up to date as it starts, connected as its owner; unset, it only checks, and `node scripts/migrate.mjs` does that, as the owner, before each start — see [The database](#the-database) |
| `PUBLIC_GOOGLE_MAPS_API_KEY`     | **unset**         | the browser key. Address lookup; unset, no address can be chosen, so none is saved                                                                                                                                             |
| `GOOGLE_MAPS_API_KEY`            | **unset**         | the server key. Confirms a chosen place, and measures a site's drive and a trip's miles; unset, no address is saved and miles are typed                                                                                        |
| `GOOGLE_MAPS_API_KEY_FILE`       | unset             | a file holding `GOOGLE_MAPS_API_KEY`, in its place                                                                                                                                                                             |
| `SMTP_HOST`                      | **unset**         | the relay email goes to — see [Email](#email). Unset, reckon sends none                                                                                                                                                        |
| `SMTP_PORT`                      | `587`             | its port; `465` where `SMTP_SECURITY=tls`                                                                                                                                                                                      |
| `SMTP_SECURITY`                  | `starttls`        | `starttls`, `tls`, or `none` for a relay on this machine                                                                                                                                                                       |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | unset             | its sign-in, where it asks; `SMTP_PASSWORD_FILE` holds the password in a file instead                                                                                                                                          |
| `SMTP_CA_FILE`                   | the system's      | the authorities to trust for its certificate, for one a private authority issued                                                                                                                                               |
| `SMTP_HELO_NAME`                 | this machine's    | the name it greets the relay with, where the relay asks for a real one                                                                                                                                                         |
| `SMTP_FROM`                      | —                 | the address email comes from; needed with `SMTP_HOST`                                                                                                                                                                          |
| `SITE_URL`                       | unset             | where reckon is reached, https://reckon.example.com: the links it emails, and the site each passkey is made for. https except to this machine. Unset, nobody can make a passkey                                                |

**Two keys, because a Google API key carries exactly one application
restriction.** It can be restricted to HTTP referrers _or_ to IP addresses,
never both — so the key a browser uses and the key this server uses cannot be
the same key without one of them being unrestricted.

**`PUBLIC_` is deliberate: that key reaches the browser.** `public: true` in `src/env.ts` is what sends it there; the prefix is what tells whoever fills in the environment. Address lookup is a
type-ahead, and the browser calls Google directly. Proxying it through here
would put the browser-to-server leg in front of every keystroke — over whatever
uplink the host has, from a phone, in the places this is used. Direct is one hop
to an edge that is near everybody.

Restrict it to **HTTP referrers** for this deployment's origin, and to two APIs:
**Maps JavaScript API** and **Places API (New)**.

The JavaScript one is not optional, and it is why the lookup goes through the
SDK rather than `fetch`. Google applies referrer restrictions to the JavaScript
API because browsers send the header; a direct web-service call wants an IP
restriction instead, which cannot mean anything when the caller is somebody
else's browser. A key calling `places.googleapis.com` from a page is
unrestrictable — the worst of the options, and not obviously so.

`GOOGLE_MAPS_API_KEY` is private in `src/env.ts` and never reaches a page. Restrict it to
**IP addresses** for this host, and to three APIs: **Address Validation API**;
**Places API (New)**, which confirms that a place id a browser sent is a place; and
**Routes API**, which gives each drive of a trip being recorded its miles, and a
site its round trip and drive time whenever its place is chosen — every site's at
once when the business's is. Each is used once per address or once per change to
a trip's stops, rather than once per keystroke, so the round trip that ruled out
proxying the autocomplete does not apply. A
trip's route is one request at the Essentials tier, ten places between its first
and last at most, and no traffic; a site's is one request, from the business by
the site and back.

A host with IPv6 reaches Google over it whenever it can, from addresses that
change within its prefix. Restrict the key to that range — its `/64` — as well as
its IPv4 address: a key that admits only one refuses the other, and every address
is refused with it.

An address is chosen, never typed. Wherever one is looked up — a site's, the
business's own — it is one field: what is typed asks Google for suggestions,
choosing one saves it, and leaving without choosing changes nothing. The server
asks Google whether the place is one before it stores the address's street, city,
state and postcode with the place id, and an address Google could not confirm is
not saved. Google's Places policy lets the place id be kept indefinitely and the
street address an end user selects be kept as theirs; reckon keeps no coordinates.
Without both keys, or without a connection, the field says so and takes nothing:
there is no typed address standing in for a place.

## Documents

```bash
npm run print                                       every document under docs/, into print/
npm run print:build -- docs/schema-reference.typ    one of them
npm run print:check                                 the audit, refusing without its tools
```

Every build is audited for what `typst compile` reports as success: a font
substituted, a glyph that vanished, ink inside the unprintable margin, text
printed on text. A finding fails the build, with the PDF still written to look
at. The audit needs poppler and a Python, and a build without them says it was
not audited. **Always `npm run print:check` before a document goes anywhere**:
it is the same audit, and it refuses to run without them.

A document whose inputs have not changed since a build that passed its audit is
not built again: press keeps a record of that build in
`third_party/press/.build-record`, which its own `.gitignore` keeps out of git.
`print:check` audits every time.

The stamp — when a document's content last changed — is in UTC, so a page that
prints it says the same wherever it was built.

The scripts call press's own `all.sh` and `build.sh`, which are plain `sh`.

`print/` is gitignored — it is derived.

press is at `third_party/press/`, committed as its release installed it. A newer
release is the installer line in `third_party/press/README.md`, run from
`third_party/`, and the diff it leaves. Only ever a release, never press's
`main` between releases.

## Regenerating the schema reference

```bash
python3 docs/schema/make-printable.py
npm run print:build -- docs/schema-reference.typ
```

The diagrams are the source; the reference derives from them, so the two cannot
drift. The script writes what it reads out of them as data,
`docs/schema/reference.json`, and the reference reads that: nothing it prints is
read as markup, and a changed `reference.json` builds the reference again.

## The stack

**SvelteKit** (Svelte 5 runes), **Postgres** 18 through **Drizzle** on
node-postgres, **Better Auth**, and an **offline queue** for time capture —
IndexedDB plus retry, not a sync engine.
Printed invoices through Typst, and payments through Stripe on the client's
link, are planned; neither is wired in yet.

**The server works in UTC, and there are two clocks.** Every database
connection is opened in UTC whatever the host's default is, and every moment is
stored as `timestamptz`. Each person keeps a time zone, taken from their browser
the first time they sign in. After that, a phone in another zone asks before
changing it. Their own timesheet, the day a new entry starts on, and every moment
shown to them use it. The business keeps its own zone (Settings → Business), and
whether an invoice is overdue, how long work has waited, report months and which
price is in force use that, so everyone gets the same answer. A calendar date that
is recorded — worked on, issued, due — is the string `2026-09-17` end to end, the
same day to everyone. Dates are worked with through Temporal: a browser or a Node
that has it uses its own, and one that does not gets `temporal-polyfill` first —
on a phone only where it is missing, kept by the service worker for offline, and
on the server until Node 26.

**Every figure is written in the reader's locale, from its exact value.**
`#lib/format` is the one place that writes a date, a time, an amount or a quantity
for a person to read, on the server and in the browser, through `Intl`. Figures go
to `Intl` as their own decimal strings, never through a float. Each person sets a
locale, a 12- or 24-hour clock and the first day of their week in their profile,
beside their time zone; until they do, they follow the business's locale (Settings
→ Business), and their browser's is offered as a one-tap start. The currency is
the business's, whoever reads it. A date written in numbers alone is
year-month-day, whatever the locale.

**Light or dark is the device's.** reckon follows the device's own setting until
someone sets Light or Dark in their profile, under On this device. What that
overrides is the device's, so the choice stays on the device too: a cookie in that
browser, reaching no other, which the server reads to draw the first paint in it,
signed in or not.

adapter-node emits a standalone server. How it is then run — the service
manager, the reverse proxy, the certificates — is the host's business, past
what [Serving it](#serving-it) asks of them, and is not described here: a
description of one machine drifts from every other one.

Money lives in `NUMERIC` and arrives as a string. Arithmetic on it is exact
decimal on `BigInt`, in `#lib/decimal`, and never passes through a JS number:
cent-level correctness is the point, and a float is how a cent goes missing.
Every amount is rounded half up to its currency's own places, as `Intl` gives
them — two for dollars, none for yen, three for dinars — and a money column holds
three, enough for every currency the business can choose (`#lib/currency`). How a
tax rounds is its own rule's. A price for one of something — a service's rate, a
material's price, an hourly wage — is not an amount: it is held to four places, so
it can be finer than the currency, as 72.5¢ a mile is, and what it bills is
rounded.

## The app

```bash
npm install
cp .env.example .env                # then PGDATABASE=reckon_dev, and a BETTER_AUTH_SECRET
createdb reckon_dev
npm run db:migrate                  # and again after pulling a migration
npm run dev
npm run db:seed                     # the invented business, if it is wanted
```

It connects to the database `PGDATABASE` names, which nothing assumes, where
libpq looks on this platform: on Linux the unix socket packages usually create,
which authenticates by user rather than by password. `PGHOST` or `DATABASE_URL`
move it — to TCP, to another machine, or to a managed service.

**Capture works offline.** Time, a draft's lines and changes to them, a draft
started on site, and a trip recorded or changed are written to the browser first
and sent when there is a connection. Each new thing carries a `client_uuid` made
on the phone, unique to whoever made it, so a retry returns the row they already
sent, and the same uuid from anyone else is a row of their own. A trip's miles the phone could only estimate take Google's route when it
arrives.

**It installs as an app, and opens without a signal.** A phone offers to add
it to the home screen: named for the business, in its colour, with its logo as
the icon where the logo is fit to be one (square, and an SVG or a PNG of 512px
or more) and reckon's own tally where it is not. A service worker keeps Today,
the Time screens, the invoices with each draft and its lines, and Trips with
each recent trip not yet billed, as they were last seen, each saying how old it
is. With no signal at all the app still opens there — a timer starts and stops,
a line goes on a draft, a trip is recorded — and what was recorded posts when
any page next opens with one. Every other screen says it needs a connection
rather than showing a figure that may have changed.
Signing out empties what was kept, and a new deploy is announced with a reload,
never forced on someone mid-entry. The service worker is registered for
somebody signed in, and only then, so a client opening their invoice's link is
not installing the app.

## Licence

Copyright © 2026 Tyler Vigario. reckon is free software under the
[GNU Affero General Public License](LICENSE), version 3 or (at your option) any
later version. [`LICENSE-NOTICE.md`](LICENSE-NOTICE.md) says what that covers,
and what is deliberately not here.

## Open

- **Token lifetime** on the public invoice link.
