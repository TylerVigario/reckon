# reckon

Invoicing and time tracking, self-hosted. Built to replace FreshBooks for
Vigario Technology Solutions, and built so that somebody else could run it —
nothing about one operator is a constant in the code.

To reckon up an account is to settle it, and settling is the point: a ledger, an
invoice and a timesheet that disagree are three problems rather than one system.

## docs/decisions.md is the authority

Every decision, in Tyler's words, quoted and dated. The schema, the diagrams and
the code derive from it.

**A decision enters that file only with a quote.** If it cannot be quoted, it has
not been decided — and the right move is to ask, once, not to reason it into
existence.

**New information does not supersede an existing decision.** It sits alongside
until Tyler says which governs.

**Entries marked `[claude]` are mine.** Analysis and consequences belong in the
repository, but never in the same voice as a decision.

## Where things are

| | |
|---|---|
| `docs/decisions.md` | the authority — his words, quoted, dated |
| `docs/schema/*.drawio` | the data model, eight clusters, thirty-five tables |
| `docs/schema/regenerate.py` | laid the diagrams out the first time; overwrites hand edits |
| `docs/schema/make-printable.py` | derives the printed reference from the diagrams |
| `docs/schema-reference.typ` | generated — do not hand-edit |
| `db/migrations/` | the schema as applied SQL |
| `db/test/constraints.sql` | proves the guards, both ways |
| `db/import-client-data.py` | loads the client sheets from the `vts` repo |
| `vendor/press` | the `@vts/press` Typst package, as a submodule |

Requirements and the reasoning that produced them live in the `vts` repo at
`TASKS.md` §5.

## The database

```bash
db/apply.sh --test        build a scratch database, prove every guard, drop it
db/apply.sh <database>    apply any migration not yet recorded
```

Where the database can hold a rule rather than trusting the application to
remember it, it does — and every guard is tested both ways, because one that
also blocks ordinary use is a bug rather than a guard.

`db/apply.sh` connects the way every other Postgres client does — `PGHOST`,
`PGUSER`, `PGDATABASE`, `DATABASE_URL` — and adds nothing of its own. Being the
right user is the caller's job: a service unit says `User=`, a shell says
`sudo -u postgres db/apply.sh …`.

It checks afterwards that nothing in `public` is owned by anyone but the
database's owner, and refuses if it is. An object made by another role is
invisible to the application, and that surfaces as a permission error from
whichever query reaches it first — a long way from the cause.

## The application

```bash
/            Today — the timer, adding by hand, and today's entries
/timesheet   every entry over a range, by client, with totals
/clients     every client, and what each one is
/clients/:id its sites with the rate each carries, contacts, recent work
/settings    everything about the operator
```

Timers run in `localStorage`, several at once, above the form that starts them
— one of us can be on a job while the other is on something else, and one phone
tracks both. They survive a refresh, because a timer a reload silently ends is
worse than no timer: you find out hours later. Tapping one opens it for editing,
including the time it started, since a timer is usually started late. Nothing
reaches `time_entry` until it stops, and stopping goes through the same queue as
everything else, carrying the timer's own id as the entry's `client_uuid`.

A time entry can be removed from either list, behind an inline confirmation.
One an invoice was built from cannot: `invoice_line.time_entry_id` is `ON
DELETE RESTRICT`, and the page says to credit the invoice instead. What is
removed is written to `record_history` in full, because a time entry is what an
invoice is built from and this repository does not lose those quietly.

**Select a `DATE` as `col::text`, never bare.** postgres.js parses OID 1082
into a JS `Date` at UTC midnight, so west of Greenwich a 2026-09-09 entry
renders as Sep 08. Overriding the parser does not work — three ways were tried
against this driver — and casting in SQL says what is meant anyway: a calendar
date has no time of day.

Mobile first, because a timer is used standing in a server room: one column, a
thumb-reach tab bar, and a sidebar only once there is room for one.

**reckon's own chrome is colourless.** The single hue on screen is
`operator.accent_colour`, and the logo is served from the row that holds it —
*"it should not detract from an operator supplied logo. we must create a
settings page so eevrything required can be operator supplied."* With no
operator saved, the shell says so rather than inventing a name.

## Signing in

Sessions are rows in `session`, not signed tokens. One server, one database,
and every page reads it anyway — so a stateless token would save no round trip
and would cost the thing that matters: a session that can be revoked now. There
is also no signing key to rotate or leak.

The cookie carries 256 random bits and means nothing on its own; only its
SHA-256 is stored, so a dump of the table does not let anyone in. Passwords are
argon2id at the OWASP minimum, and the hash records its own parameters, so
raising them later re-hashes on the next sign-in rather than locking anyone out.

There is no sign-up. Two people, both already rows in `app_user`:

```bash
node scripts/set-password.mjs tyler@example.com
```

It prompts rather than taking an argument — a password in `history` or in `ps`
is a password given away — and ends every existing session for that person,
because a password change that leaves old sessions alive has changed nothing
for whoever holds one.

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
**IP addresses** for this host, and to the **Address Validation API**. It is
used once per address rather than once per keystroke, so the round trip that
ruled out proxying the autocomplete does not apply.

Both are read with `$env/dynamic/*` rather than `static`, so the same built
artifact runs on any host with any keys. `static` would bake the values in at
build time and mean one build per deployment.

Unset is a supported state, not a broken one: the address field is an ordinary
text input, which is what it was before any of this.

## Client data

Clients, sites, addresses and tax districts are edited as four keyed CSVs in the
`vts` repo at `docs/internal/client-data/`, checked with `check.py` beside them,
and loaded from here:

```bash
python3 db/import-client-data.py --from ../vts/docs/internal/client-data \
  | psql -q -v ON_ERROR_STOP=1 -d reckon_dev
```

It emits SQL rather than connecting, so nothing needs a database driver and the
SQL can be read before it is run. Re-running changes nothing.

A district rate is loaded only when the sheet gives its **effective date** —
*"rates in a csv with a proper effective date (not arbitrary validated at
timestamp)"*. Until then the districts and sites load and no rate resolves,
which is the correct state: a site with no rate refuses rather than reading as
tax-free.

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

**SvelteKit** (Svelte 5 runes), **Postgres** with money as `NUMERIC`, an
**offline queue** for time capture — IndexedDB plus retry, not a sync engine —
**Typst via press** and **Stripe** server-side.

adapter-node emits a standalone server. How it is then run — the service
manager, the reverse proxy, the certificates — is the host's business and is not
described here, because a description of one machine drifts from every other
one.

Money lives in `NUMERIC` because JavaScript has no decimal type. This system's
whole history is cent-level correctness.

## The app

```bash
createdb reckon_dev && db/apply.sh reckon_dev
cd app && npm install && npm run dev
```

`app/` is SvelteKit. It connects over a unix socket by default, which is where
most Linux packages put one and which peer-authenticates rather than asking for
a password. `PGHOST`, `PGDATABASE` or `DATABASE_URL` move it — to TCP, to
another machine, or to a managed service.

**What exists:** time capture. A timer, the fields an invoice cannot be built
without, and the offline queue — an entry is written to the browser first and
posted when there is a connection. `POST /api/time` is safe to call twice with
the same body, because `client_uuid` is made on the phone and carries a unique
index; a retry returns the row that already exists.

**What does not:** everything else. Trips, invoicing, the catalogue, reports,
settings.

## Open

Five questions, listed at the end of `docs/decisions.md`. One of them —
the decimal library — blocks the first money arithmetic in the application
layer, though not time capture, which counts whole minutes.
