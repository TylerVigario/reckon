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

| | |
|---|---|
| `app/src/lib/server/db/schema/` | the schema, in TypeScript, a file per area, with every table's reasons beside it |
| `db/migrations/` | the schema as applied SQL: generated from the above, and one hand-written migration for what Drizzle cannot say |
| `db/test/constraints.sql` | proves the guards, both ways |
| `app/src/lib/server/valuation/` | what an hour bills, what it pays, what a retainer covers, and the tax split — exact decimals, tested |
| `docs/schema/*.drawio` | the data model: an overview and seven clusters |
| `docs/schema/regenerate.py` | lays the diagrams out from one definition of the tables; overwrites hand edits |
| `docs/schema/make-printable.py` | derives the printed reference from the diagrams |
| `docs/schema-reference.typ` | generated — do not hand-edit |
| `vendor/press` | the `@vts/press` Typst package, as a submodule |

## The database

```bash
db/apply.sh --test        build a scratch database, prove every guard, drop it
db/apply.sh <database>    apply any migration not yet recorded
```

Where the database can hold a rule about what may be stored rather than
trusting the application to remember it, it does — and every guard is tested
both ways, because one that also blocks ordinary use is a bug rather than a
guard. What a stored row is *worth* is the application's: it is arithmetic, and
it is done once, in `$lib/server/valuation`.

The schema is changed in `app/src/lib/server/db/schema/`, and the migration
written from it:

```bash
cd app && npx drizzle-kit generate --name what-changed
```

What Drizzle cannot express — the triggers that freeze a sent invoice and keep
the history, one foreign key, the roles every operator starts with — is in the
hand-written `db/migrations/0001_integrity.sql`. `db/apply.sh` runs the
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
```

Timers run in `localStorage`, several at once — one person can be on a job
while another is on something else, and one phone tracks both. They survive a
refresh, because a timer a reload silently ends is worse than no timer: you find
out hours later. Nothing reaches `time_entry` until one stops. Stopping writes
its entry to the same queue as everything else, dated the day it started and
carrying the timer's own id as the entry's `client_uuid`.

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

**`ORIGIN` must be set when the server runs**, or adapter-node cannot verify
where a form came from and rejects every POST with 403 — sign-in included. It
is the public URL a browser used, so behind a reverse proxy that is the
`https://` name and not the address the process is listening on.

## Environment

Everything the process needs, and nothing that belongs in the database.
[`app/.env.example`](app/.env.example) is the same list with the reasoning, and
is what to copy to `app/.env` for local development — beside `vite.config.ts`,
because that is the only directory Vite reads a `.env` from.

| | | |
|---|---|---|
| `ORIGIN` | **required** | the public URL a browser used. Without it adapter-node cannot verify where a form came from and refuses every POST with 403, sign-in included. Behind a proxy this is the `https://` name, not the address the process listens on |
| `BETTER_AUTH_SECRET` | **required** | signs every session cookie; 32 characters at least, random — `openssl rand -hex 32`. Without it the server does not start. Changing it signs everybody out |
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | set it to `127.0.0.1` where a reverse proxy is the only route in, so the bind enforces that rather than convention |
| `PGHOST` | `/var/run/postgresql` | a unix socket, which peer-authenticates rather than asking for a password |
| `PGDATABASE` | `reckon_dev` | |
| `DATABASE_URL` | — | wins outright over `PGHOST`/`PGDATABASE`, for TCP, another machine, or a managed service |
| `PUBLIC_GOOGLE_MAPS_API_KEY` | **unset** | the browser key. Enables address lookup; unset, addresses are typed |
| `GOOGLE_MAPS_API_KEY` | **unset** | the server key. Validates a chosen address; unset, it is stored as Google returned it |

**Two keys, because a Google API key carries exactly one application
restriction.** It can be restricted to HTTP referrers *or* to IP addresses,
never both — so the key a browser uses and the key this server uses cannot be
the same key without one of them being unrestricted.

**`PUBLIC_` is deliberate: that key reaches the browser.** Address lookup is a
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

`GOOGLE_MAPS_API_KEY` has no prefix and never reaches a page. Restrict it to
**IP addresses** for this host, and to two APIs: **Address Validation API**, and
**Places API (New)**, which confirms that a place id a browser sent is a place. It is
used once per address rather than once per keystroke, so the round trip that
ruled out proxying the autocomplete does not apply.

Both are read with `$env/dynamic/*` rather than `static`, so the same built
artifact runs on any host with any keys. `static` would bake the values in at
build time and mean one build per deployment.

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
`localStorage` plus retry, not a sync engine.
Printed invoices through Typst and card payments through Stripe are planned;
neither is wired in yet.

adapter-node emits a standalone server. How it is then run — the service
manager, the reverse proxy, the certificates — is the host's business and is not
described here, because a description of one machine drifts from every other
one.

Money lives in `NUMERIC` and arrives as a string. Arithmetic on it is exact
decimal on `BigInt`, in `$lib/decimal`, and never passes through a JS number:
cent-level correctness is the point, and a float is how a cent goes missing.

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

**Time capture works offline.** An entry is written to the browser first and
posted when there is a connection. `POST /api/time` is safe to call twice with
the same body, because `client_uuid` is made on the phone and carries a unique
index; a retry returns the row that already exists.

## Open

- **Token lifetime** on the public invoice link.
