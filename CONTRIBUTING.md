# Contributing

Thanks for the interest. A few things up front:

- This is a small project with one maintainer, and the priorities are whatever
  comes next on the list. Bug reports and security issues get faster attention
  than adjacent feature work.
- The **software** is [AGPL-3.0-or-later](LICENSE). By submitting a contribution
  you agree to license it under the same terms — no CLA, no copyright
  assignment.
- **Every client, site, address and figure here is invented.** The seed, the
  guard suite, the schema's comments and the docs describe a fictional
  business, and no real client's records are in any commit — see
  [LICENSE-NOTICE.md](LICENSE-NOTICE.md). A fork puts its own clients in.
  A contribution that needs an example invents one.
- There is no chat, no Discord. The conversation lives in issues and pull
  requests.

## Reporting a bug

Open an [issue](https://github.com/TylerVigario/reckon/issues/new) with what you
expected, what happened, the minimal steps to reproduce it, and the commit or
tag. Describe the problem, not a proposed fix.

## Reporting a security issue

**Not a public issue.** Use the private process in [SECURITY.md](SECURITY.md).

## The rules this repository is built on

Reading these first will save an argument later.

**The reasoning is kept beside the rule.** The schema says why each rule
exists, table by table, and the guard suite proves it. A change that
contradicts a rule says which, and why.

**The database holds what may be stored; the application works out what it is
worth.** Where a constraint or a trigger can refuse a row that should not
exist, it does — because two callers can disagree about a rule and cannot
disagree about a constraint. What an hour bills, what it pays and what a
retainer covers is arithmetic, done once, in exact decimals, in
`src/lib/server/valuation`, and tested there. A pull request that moves a
rule between the two needs to say why.

**Every guard is tested both ways.** `tests/db/constraints.sql` asserts that the
wrong thing is refused _and_ that the ordinary thing is allowed. A guard that
also blocks ordinary use is a bug, not a guard, and a guard that passes for the
wrong reason is what the second assertion catches.

**The schema is one place, and it says what is true.** The migrations in
`src/lib/server/db/migrations/` make every table, and are how anybody learns
what the database holds: the first is the whole schema, a file per area, with
each table's reasons beside it. `src/lib/server/db/database.ts` is generated
from the database they build, with `npm run db:types`, and Kysely checks every
query against it; CI fails when it is not what the migrations make.

**A migration is added and never edited.** Other people's databases already
ran the old one. It takes `Kysely<any>` and imports nothing of the app's, so it
does today what it did the day it was written; it is named for the moment it
was written, so the names sort in the order they run, and listed in the
folder's `index.ts`. Each runs in its own transaction, so a word added to one
of the schema's types is added by one migration and used by a later one:
Postgres will not use a new enum value in the transaction that added it.

**A query is checked.** Kysely's builder checks every table, column and value
against `database.ts`. Inside a `sql` template a column is written
`${eb.ref('invoice.status')}`, which is checked too; a name typed into the
template is not, so it is not written that way. `sql<T>` says what an
expression returns and nothing checks it, so it is for what the builder cannot
type.

**Every route says who reaches it.** `src/lib/access.ts` names the level each
route needs — open, Field or Full — and `hooks.server.ts` refuses anything
beyond someone's level before the route runs. A route added without a line
there does not typecheck. A route Field reaches is scoped where it runs as well,
to that person's own work, so a new one says in its load or handler what
someone with Field sees of it.

## Getting it running

```bash
git clone https://github.com/TylerVigario/reckon.git
cd reckon

npm ci                      # the dependencies, and the git hooks

cp .env.example .env
$EDITOR .env                # PGDATABASE=reckon_dev, BETTER_AUTH_SECRET=$(openssl rand -hex 32)

createdb reckon_dev
npm run db:test             # prove the schema before applying it anywhere
npm run db:migrate
npm run db:seed                                                    # the invented business
node scripts/user.mjs password avery@kestrel.example --insecure   # its owner, Avery
npm run dev
```

`.env.example` assumes no database and no secret, in development either: until
`.env` names both, the server and the commands stop and say which is missing.

**`npm ci` installs the git hooks**: `commit-msg`, without which a bad commit
message is only caught when CI rejects the pull request title, and `pre-push`,
which runs `npm run ci` before anything leaves.

**No dependency runs an install script.** esbuild's is the only one in the tree,
and `allowScripts` in `package.json` denies it. It swaps esbuild's launcher for
the binary, a speed-up for the `esbuild` command, which nothing here runs, and
esbuild works without it. npm names any dependency that brings a new one: read
what it does, then `npm approve-scripts` or `npm deny-scripts` it.

**A package is added with `npm install --save-dev`.** Everything is bundled, so
every package is a devDependency; one in `dependencies` would be left out of
the bundle and missing from a release, and a test says so.

The database commands read `.env` as `npm run dev` does, under whatever the shell
sets, and connect the way the server does, so `PGHOST`, `PGUSER` and the rest
apply. If your cluster wants a different user, become one:
`sudo -u postgres npm run db:migrate`. The server only checks its database,
and will not start while a migration is waiting: after pulling one, or
writing your own, `npm run db:migrate` applies it.

Node is pinned in [`.nvmrc`](.nvmrc). Postgres 18 or newer — every id defaults
to `uuidv7()`, which does not predate it. CI runs 18, which is what the guards
are proved against.

## Before you open a pull request

```bash
npm run ci
```

That is formatting, linting, typechecking, the unit tests at both ends of the
date line, the generated types checked against the migrations, the guard suite and the
build, in one command. `pre-push` runs it, so a push it fails does not leave.
`git push --no-verify` skips it, and CI runs every check regardless.

What it does not run is the behaviour suite — the checks in `tests/`
that sign in and drive the running application. Those need a database and a
browser, so CI runs them and this command does not. A green run here is not a
green CI run, and the difference is the assertions most worth having.

The pull request **title is the commit**. Merges are squash-only with an empty
body, so the title is the entire record of the change and has to be a
[Conventional Commit](https://www.conventionalcommits.org). `feat` and `fix` are
the only two types the specification gives meaning to; the rest are labels. It is
checked against [`@tylervigario/commitlint-config`](https://github.com/TylerVigario/commitlint-config),
which holds to the specification and nothing more: a type and a subject, types in
any case, and no rule about case, length or punctuation. A revert is titled like
any other change, `revert: feat: …`, not with the `Revert "feat: …"` GitHub's
revert button writes, which no changelog tool can read.
