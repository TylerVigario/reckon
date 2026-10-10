# What this licence covers

Copyright © 2026 Tyler Vigario.

reckon is free software: you can redistribute it and/or modify it under the
terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. It is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
for more details.

`LICENSE` is the verbatim AGPL-3.0-or-later text and governs **the
software**, which is everything in this repository. This file says so
plainly, and says what is deliberately not here.

## Granted under AGPL-3.0-or-later

The machinery. Everything that would still be useful for a different
business with different clients in it:

- `src/` and `static/` — the SvelteKit application in full: routes,
  components, the capture queue, the session handling, the database access
- `drizzle/`, `tests/` and `scripts/` — the migrations, the guard suite and
  the behaviour checks, and the commands that apply, prove and release them
- `docs/schema/` — the diagram generator and the printable it derives
- `.github/` and the build configuration

Fork it, change it, run it. If you modify it and serve it over a
network, AGPL §13 obliges you to offer your users your modified source
in turn. That is the whole reason this licence was chosen: an invoicing
system that someone improves and then closes is the outcome the licence
exists to prevent.

## Not here — any business's own records

Clients, sites, rates, agreements and hours are rows in a database, not
files, and no real client's records are in this repository in any
commit. Every one that appears — in the seed, a guard, a schema
comment or the docs — is invented: Kestrel Field Services and its
clients do not exist. An address CDTFA is asked to price is a public
place, so the rate beside it is real; one it never is, is plainly made up.

Each rule comes with an example so that it can be checked, and every
example is made up. A fork gets the system and puts its own clients
in it.
