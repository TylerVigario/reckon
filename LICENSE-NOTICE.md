# What this licence covers

`LICENSE` is the verbatim AGPL-3.0-or-later text and governs **the
software**. One category is reserved and is **not** granted under it.
This file states which is which, so nobody has to infer it from a
directory layout that can move.

## Granted under AGPL-3.0-or-later

The machinery. Everything that would still be useful for a different
business with different clients in it:

- `app/` — the SvelteKit application in full: routes, components, the
  capture queue, the session handling, the database access
- `db/` — the schema as migrations, the guard suite, and the tooling
  that applies and proves them
- `docs/schema/` — the diagram generator and the printable it derives
- `.github/` and the build configuration

Fork it, change it, run it. If you modify it and serve it over a
network, AGPL §13 obliges you to offer your users your modified source
in turn. That is the whole reason this licence was chosen: an invoicing
system that someone improves and then closes is the outcome the licence
exists to prevent.

## Reserved — © Vigario Technology Solutions, All Rights Reserved

**The business's own records.** Nothing in this repository should carry
them, and the schema is built so that it does not have to: clients,
sites, rates, agreements and hours are rows in a database, not files
here. Where a real name, address or figure appears — in a migration
comment explaining why a rule exists, in `docs/decisions.md`, or in a
test fixture — it is there as the evidence for a design decision, and it
is reserved.

A fork gets the system and puts its own clients in it.

## Why the distinction is drawn rather than implied

Copyright in the records is held regardless of what any file says; a
licence is a grant, and what is not granted is reserved. But an
unstated reservation inside a repository published under a copyleft
licence reads as an oversight, and a reader acting in good faith should
not have to guess where the line is.

The line matters more here than in most projects, because the reasoning
that makes this schema worth reading is inseparable from the invoices
that produced it. `docs/decisions.md` is quoted from real conversations
and `db/test/constraints.sql` names real sites, because a rule with no
case behind it is a rule nobody can check. Those cases are the reserved
part; the rules they justify are not.
