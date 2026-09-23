# Contributing

Thanks for the interest. A few things up front:

- This is the invoicing and time-tracking system Vigario Technology Solutions
  runs on — a small project with one maintainer, and the priorities are whatever
  the business needs next. Bug reports and security issues get faster attention
  than adjacent feature work.
- The **software** is [AGPL-3.0-or-later](LICENSE). By submitting a contribution
  you agree to license it under the same terms — no CLA, no copyright
  assignment.
- The **business's own records** are not part of that grant. Real client names,
  addresses and figures appear throughout `docs/decisions.md`,
  `db/test/constraints.sql` and the migration comments, and they are there as the
  evidence for a design decision — see [LICENSE-NOTICE.md](LICENSE-NOTICE.md).
  A fork puts its own clients in.
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

**`docs/decisions.md` is the authority.** The schema, the diagrams and the code
derive from it. Entries marked `[claude]` are analysis rather than decisions, and
are marked so they can be told apart.

**The database holds the rules, not the application.** Where a constraint,
trigger or view can enforce something, it does — because two callers can
disagree about a rule and cannot disagree about a constraint. A pull request
that moves a rule out of the schema and into a code path needs to say why.

**Every guard is tested both ways.** `db/test/constraints.sql` asserts that the
wrong thing is refused *and* that the ordinary thing is allowed. A guard that
also blocks ordinary use is a bug, not a guard — several in this repository
turned out to be passing for the wrong reason, and the second assertion is what
caught them.

**The schema is one file, and it says what is true.** `db/migrations/0001_the_schema.sql`
creates the database as it stands. It was folded from twenty-two migrations
before the first release, because replaying a conversation — a column added,
moved, renamed, and twice removed again the same day — is not how anybody should
learn what the database holds.

**After the first release, a migration is added and never edited.** A schema
somebody else is running cannot be rewritten under them. Until then, folding is
allowed and was done once.

**The reasoning outlives the migration that carried it.** A change worth
explaining is explained in `docs/decisions.md`, in the schema file's own
comments, and in a guard that refuses the old shape — not in a file whose only
reader is `psql`. The clearest example survives all three: a site does not
belong to its client, and the guard that says so cites the invoice proving it.

## Getting it running

```bash
git clone --recurse-submodules https://github.com/TylerVigario/reckon.git
cd reckon

npm ci                      # repository tooling, and the git hooks
npm ci --prefix app         # the application

cp app/.env.example app/.env
$EDITOR app/.env            # PGDATABASE=reckon_dev, ORIGIN=http://localhost:5173

createdb reckon_dev
db/apply.sh --test          # prove the schema before applying it anywhere
db/apply.sh reckon_dev      # apply every migration not yet recorded

cd app
node scripts/set-password.mjs you@example.com   # after seeding an app_user
npm run dev
```

`app/.env.example` carries **production** defaults, so change the database and
the origin before using it — a file that defaults to a development database is
one copy away from a production process writing invoices into it.

**Both `npm ci` commands, and the root one first.** It installs the `commit-msg`
hook, and without it a bad commit message is only caught when CI rejects the
pull request title.

`db/apply.sh` connects the way `psql` does, so `PGHOST`, `PGUSER` and the rest
apply. If your cluster wants a different user, become one:
`sudo -u postgres db/apply.sh …`.

Node is pinned in [`.nvmrc`](.nvmrc). Postgres 15 or newer — the schema uses
`UNIQUE NULLS NOT DISTINCT`, which does not predate it. CI runs 18, which is
what the guards are proved against.

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
the only two types the specification gives meaning to; the rest are labels.
