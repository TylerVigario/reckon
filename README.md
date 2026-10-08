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
exists, table by table, and `db/test/constraints.sql` proves it both ways,
against an invented case.

## Where things are

|                                 |                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `app/src/lib/server/db/schema/` | the schema, in TypeScript, a file per area, with every table's reasons beside it                                |
| `db/migrations/`                | the schema as applied SQL: generated from the above, and hand-written migrations for whatever Drizzle can't say |
| `db/test/constraints.sql`       | proves the guards, both ways                                                                                    |
| `app/src/lib/server/valuation/` | what an hour bills, what it pays, what a retainer covers, and the tax split — exact decimals, tested            |
| `docs/schema/*.drawio`          | the data model: an overview and eight clusters                                                                  |
| `docs/schema/regenerate.py`     | lays the diagrams out from one definition of the tables; overwrites hand edits                                  |
| `docs/schema/make-printable.py` | derives the printed reference from the diagrams                                                                 |
| `docs/schema-reference.typ`     | generated — do not hand-edit                                                                                    |
| `vendor/press`                  | the `@vts/press` Typst package, as a submodule                                                                  |

## The database

```bash
db/apply.sh --test        build a scratch database, prove every guard, drop it
db/apply.sh <database>    apply any migration not yet recorded
```

Where the database can hold a rule about what may be stored rather than
trusting the application to remember it, it does — and every guard is tested
both ways, because one that also blocks ordinary use is a bug rather than a
guard. What a stored row is _worth_ is the application's: it is arithmetic, and
it is done once, in `#lib/server/valuation`.

The schema is changed in `app/src/lib/server/db/schema/`, and the migration
written from it:

```bash
cd app && npx drizzle-kit generate --name what-changed
```

What Drizzle cannot express — the triggers that freeze a sent invoice and keep
the history, one foreign key, the roles every operator starts with — is in the
hand-written `db/migrations/0001_integrity.sql`, with its invoice guards made to
hold in `0002_sent_invoices_hold.sql` and a file described in the history rather
than copied into it in `0003_history_describes_binary.sql`. A new one starts as
`npx drizzle-kit generate --custom --name what-changed`. `db/apply.sh` runs the
migrations with node, so it needs node and the application's dependencies: a
clone's `app/node_modules`, or a release's own.

`db/apply.sh` connects the way every other Postgres client does — `PGHOST`,
`PGPORT`, `PGUSER`, `PGPASSWORD` — and adds nothing of its own; the database
is named on its command line. Being the
right user is the caller's job: a service unit says `User=`, a shell says
`sudo -u postgres db/apply.sh …`.

It checks afterwards that nothing in `public` or `drizzle` — where the record
of applied migrations is kept — is owned by anyone but the database's owner,
and refuses if it is. An object made by another role is
invisible to the application, and that surfaces as a permission error from
whichever query reaches it first — a long way from the cause.

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

The cookie is the session's token signed with `BETTER_AUTH_SECRET`, so a copy
of the table lets nobody in without the secret as well. Passwords are argon2id
at the OWASP minimum rather than Better Auth's default scrypt, and the hash
records its own parameters, so raising them later re-hashes on the next sign-in
rather than locking anyone out. Five wrong passwords from one address in
fifteen minutes and that address waits; the limit is per address and never per
account, so it says nothing about which addresses have one.

There is no sign-up. Everyone who signs in is added from the command line:

```bash
node app/scripts/user.mjs add you@example.com "Your Name" --role Partner
node app/scripts/user.mjs password you@example.com
node app/scripts/user.mjs list
```

It prompts for the password rather than taking an argument — a password in
`history` or in `ps` is a password given away — and ends every existing session
for that person, because a password change that leaves old sessions alive has
changed nothing for whoever holds one.

Twelve characters at least, checked on the first entry rather than after the
second. On a development database, `--insecure` lifts that and says so:

```bash
node app/scripts/user.mjs password avery@kestrel.example --insecure   # the seeded user
```

**`BETTER_AUTH_SECRET` must be set when the server runs**, 32 characters at
least, or it will not start. Left to itself Better Auth would sign with a default
that is printed in its own source.

**The session cookie is `Secure`** unless `SECURE_COOKIES=false`, so a browser
only ever sends it over https. Turning that off is for a proxy that serves plain
http, and what it costs is the session token crossing that network in the
clear — the server says so in its log every time it starts.

## Serving it

**There is no address to configure.** The server reads its own from each
request — the `Host` header, over https — so the address a form is checked
against is always the one the browser used. A configured address can disagree
with that, and when it does every form post is refused as cross-site, sign-in
included.

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
the per-address sign-in limit becomes one limit for everyone, five wrong
passwords from anyone lock everyone out, and every session records the proxy.
Name a header the proxy sets from the connection. One it overwrites, like an
`X-Real-IP` set from the connection's address, needs nothing else.
`X-Forwarded-For` is one a client can start, so it also needs `XFF_DEPTH`: the
number of proxies in front, 1 for one.

## Environment

Everything the process needs, and nothing that belongs in the database.
[`app/src/env.ts`](app/src/env.ts) declares each variable with its default and
its check, and every one is read when the server starts rather than built in, so
the same artifact runs on any host with any values. A value that fails its check
stops the server at start with the reason.

[`app/.env.example`](app/.env.example) is the same list as a file, and is what
to copy to `app/.env` for local development — beside `vite.config.ts`, because
that is the only directory Vite reads a `.env` from.

|                                  |                       |                                                                                                                                                                    |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`             | **required**          | signs every session cookie; 32 characters at least, random — `openssl rand -hex 32`. Without it the server does not start. Changing it signs everybody out         |
| `SECURE_COOKIES`                 | `true`                | `false` only behind a proxy that serves plain http — see [Serving it](#serving-it)                                                                                 |
| `PORT`                           | `3000`                |                                                                                                                                                                    |
| `HOST`                           | `0.0.0.0`             | set it to `127.0.0.1` where a reverse proxy is the only route in, so the bind enforces that rather than convention                                                 |
| `PROTOCOL_HEADER`, `HOST_HEADER` | unset                 | read by adapter-node: the headers a proxy uses for the scheme and the public name, where it does not pass them as https and `Host` — see [Serving it](#serving-it) |
| `ADDRESS_HEADER`, `XFF_DEPTH`    | unset                 | read by adapter-node: the header holding a visitor's address. **Needed behind any proxy** — unset, every visitor is the proxy — see [Serving it](#serving-it)      |
| `PGHOST`                         | `/var/run/postgresql` | a unix socket, which peer-authenticates rather than asking for a password                                                                                          |
| `PGDATABASE`                     | `reckon_dev`          |                                                                                                                                                                    |
| `DATABASE_URL`                   | —                     | wins outright over `PGHOST`/`PGDATABASE`, for TCP, another machine, or a managed service                                                                           |
| `PUBLIC_GOOGLE_MAPS_API_KEY`     | **unset**             | the browser key. Enables address lookup; unset, addresses are typed                                                                                                |
| `GOOGLE_MAPS_API_KEY`            | **unset**             | the server key. Validates a chosen address and gives a trip's drives their miles; unset, an address is stored as Google returned it and miles are typed            |

**Two keys, because a Google API key carries exactly one application
restriction.** It can be restricted to HTTP referrers _or_ to IP addresses,
never both — so the key a browser uses and the key this server uses cannot be
the same key without one of them being unrestricted.

**`PUBLIC_` is deliberate: that key reaches the browser.** `public: true` in `app/src/env.ts` is what sends it there; the prefix is what tells whoever fills in the environment. Address lookup is a
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

`GOOGLE_MAPS_API_KEY` is private in `app/src/env.ts` and never reaches a page. Restrict it to
**IP addresses** for this host, and to three APIs: **Address Validation API**;
**Places API (New)**, which confirms that a place id a browser sent is a place; and
**Routes API**, which gives each drive of a trip being recorded its miles. Each is
used once per address or once per change to a trip's stops, rather than once per
keystroke, so the round trip that ruled out proxying the autocomplete does not
apply. A trip's route is one request at the Essentials tier, ten places between its
first and last at most, and no traffic.

A host with IPv6 reaches Google over it whenever it can, from addresses that
change within its prefix. Restrict the key to that range — its `/64` — as well as
its IPv4 address: a key that admits only one refuses the other, and each lookup
falls back without a word to the person using the app.

Unset is a supported state, not a broken one: the address field is an ordinary
text input.

## Documents

```bash
just build docs/schema-reference.typ
just all
just check docs/schema-reference.typ
just clean
```

**Always `just check` before a document goes anywhere.** It catches font
substitution and ink inside the unprintable margin, both of which `typst
compile` reports as success.

`print/` is gitignored — it is derived.

## Regenerating the schema reference

```bash
python3 docs/schema/make-printable.py
just build docs/schema-reference.typ
```

The diagrams are the source; the reference derives from them, so the two cannot
drift.

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
cd app && npm install && cd ..
createdb reckon_dev && db/apply.sh reckon_dev
cd app && npm run dev
```

`app/` is SvelteKit. By default it connects to Postgres over the unix socket
Linux packages usually create, which authenticates by user rather than by
password. `PGHOST`, `PGDATABASE` or `DATABASE_URL` move it — to TCP, to
another machine, or to a managed service.

**Capture works offline.** Time, a draft's lines and changes to them, a draft
started on site, and a trip recorded or changed are written to the browser first
and sent when there is a connection. Each new thing carries a `client_uuid` made
on the phone under a unique index, so a retry returns the row that already
exists. A trip's miles the phone could only estimate take Google's route when it
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
