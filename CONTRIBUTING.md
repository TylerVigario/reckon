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
`app/src/lib/server/valuation`, and tested there. A pull request that moves a
rule between the two needs to say why.

**Every guard is tested both ways.** `db/test/constraints.sql` asserts that the
wrong thing is refused _and_ that the ordinary thing is allowed. A guard that
also blocks ordinary use is a bug, not a guard, and a guard that passes for the
wrong reason is what the second assertion catches.

**The schema is one place, and it says what is true.**
`app/src/lib/server/db/schema/` defines every table, a file per area, and is how
anybody learns what the database holds. The migrations are generated from it
with `npx drizzle-kit generate` in `app/`, and CI fails a schema change that
arrives without its migration. What Drizzle cannot express is in the one
hand-written migration, `db/migrations/0001_integrity.sql`.

**After the first release, a migration is added and never edited.** Other
people's databases already ran the old one.

## Getting it running

```bash
git clone --recurse-submodules https://github.com/TylerVigario/reckon.git
cd reckon

npm ci                      # repository tooling, and the git hooks
npm ci --prefix app         # the application

cp app/.env.example app/.env
$EDITOR app/.env            # PGDATABASE=reckon_dev

createdb reckon_dev
db/apply.sh --test          # prove the schema before applying it anywhere
db/apply.sh reckon_dev      # apply every migration not yet recorded

cd app
psql -d reckon_dev -f ../db/seed/demo.sql                              # the invented business
node scripts/user.mjs password avery@kestrel.example --insecure   # its owner, Avery
npm run dev
```

`app/.env.example` carries **production** defaults, so change the database
before using it — a file that defaults to a development database is one copy
away from a production process writing invoices into it.

**Both `npm ci` commands, and the root one first.** It installs the `commit-msg`
hook, and without it a bad commit message is only caught when CI rejects the
pull request title.

`db/apply.sh` connects the way `psql` does, so `PGHOST`, `PGUSER` and the rest
apply. If your cluster wants a different user, become one:
`sudo -u postgres db/apply.sh …`. It runs the migrations with node, from the
application's dependencies, which is why `npm ci --prefix app` comes first.

Node is pinned in [`.nvmrc`](.nvmrc). Postgres 18 or newer — every id defaults
to `uuidv7()`, which does not predate it. CI runs 18, which is what the guards
are proved against.

## Before you open a pull request

```bash
npm run ci        # from the repository root
```

That is the guard suite and then the application's own gate, in one command.
**From the root, not from `app/`**: the application's `ci` script is formatting,
linting, typechecking, the unit tests and the build, and running that one leaves
the schema unproven while looking like it did not.

What it does not run is the behaviour suite — the harnesses in `app/scripts`
that sign in and drive the running application. Those need a database and a
browser, so CI runs them and this command does not. A green run here is not a
green CI run, and the difference is the assertions most worth having.

The pull request **title is the commit**. Merges are squash-only with an empty
body, so the title is the entire record of the change and has to be a
[Conventional Commit](https://www.conventionalcommits.org). `feat` and `fix` are
the only two types the specification gives meaning to; the rest are labels. It is
checked against [`@vts/commitlint-config`](https://github.com/TylerVigario/commitlint-config),
which holds to the specification and nothing more: a type and a subject, types in
any case, and no rule about case, length or punctuation.
