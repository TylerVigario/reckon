# Security

## Reporting

**Do not open a public issue.**

Use [private vulnerability reporting](https://github.com/TylerVigario/reckon/security/advisories/new)
on this repository. It goes to the maintainer and to nobody else.

Expect an acknowledgement within a few days. This is a one-maintainer project
run alongside other work, so a fix may take longer than an acknowledgement — you
will be told which is happening.

## What is in scope

The software in this repository: the application, the schema and the tooling
around them. In particular:

- anything that lets one signed-in person act as another
- anything that reaches data without a session
- anything that gets a session, the code in an emailed link or a client's
  records out of the system
- a constraint in the migrations (`src/lib/server/db/migrations/`) that can
  be worked around from the application

## What is not

- the hosts this happens to run on, which are configured elsewhere
- the client names, addresses and rates in the seed, the guard suite and the
  docs. Every one is invented; an address CDTFA is asked to price is a public
  place, and one it never is, is plainly made up
- dependency advisories with no path to exploitation here. Report them, but
  they are triaged as maintenance

## What this project already assumes

Worth knowing before reporting, because these are decisions rather than
oversights:

- **Signing in is with a passkey, and nothing else.** There are no passwords,
  and the database refuses to hold one. A passkey is made for this site's host
  name and taken only from its own origin, so a lookalike site cannot use it,
  and only its public half is kept. One made or used without the authenticator
  checking who is holding it — a fingerprint, a face, a screen lock — is
  refused.
- **There is no sign-up.** Someone with Full adds people on Team, and the first
  person is added with `bin/reckon user add` on the host. Each is emailed a link to
  make their first passkey. Someone who has lost theirs is sent a new link by
  someone with Full, which ends none of the passkeys they have; a lost phone's
  passkeys are ended on Team. Someone with Full keeps at least one passkey.
- **An emailed link is good once, for an hour at most**, and only while its
  person is active and still signs in with the address it went to. A change of
  address is the exception: its link goes to the new address, which becomes the
  one they sign in with only once the link is used, and the old address is
  told. A link's code is 256 random bits, and only the code's SHA-256 is kept.
  One link of each kind waits at a time, and a new one ends the last. A code
  that is not one to use is recorded against the network it came from, an IPv6
  address counting as its /64, and ten in fifteen minutes make that network
  wait.
- **Better Auth's own routes are rate limited from the database**, so a restart
  forgives nothing.
- **Sessions are database rows**, by Better Auth, so one can be revoked now.
  The cookie is the row's token signed with `BETTER_AUTH_SECRET`: a copy of the
  `session` table lets nobody in without the secret too, and changing the
  secret signs everybody out. The server will not start without one. A session
  lasts until it has gone two weeks unused.
- **The security log keeps every sign-in, refused or not**, every passkey and
  link, everyone added or changed, every change of access and every refusal for
  lack of it, each also a line in the server's log. The database stamps each
  with its own clock, and its triggers refuse any change, and any removal until
  an event is a year old; only the table's owner could switch them off, and the
  server's role owns nothing. Each person sees their own, and someone with Full
  everyone's.
- **Email crosses the network under TLS**, at 1.2 or later, with the relay's
  certificate always checked: STARTTLS that a relay does not offer means nothing
  is sent, not that it is sent in the clear. `SMTP_SECURITY=none` is for a
  relay on the same machine; to any other the server says so at every start,
  and never sends the relay's password over it. That password can be a file
  rather than in the environment, and is never logged.
- **An email keeps what it said only until it is sent** or given up on, and its
  row is deleted after 90 days. A person is told by email whenever a passkey of
  theirs is added or removed, or all of them are ended, and whenever their name,
  their address or their access changes, or they are made inactive or active
  again, with who to ask if it was not them.
- **Whatever has a body to run carries a content security policy.** A page gets
  the one SvelteKit writes, with its own inline code hashed. What an endpoint
  returns — the logo, the operator's stylesheet, the manifest, the API — gets
  one that runs nothing and is sandboxed, so an uploaded SVG logo opened
  directly cannot act as the site. The redirect and the 401 that turn a
  signed-out request away carry none, having nothing in them to run.
- **What each person reaches is checked on the server, and refused by
  default.** Every route names the level it needs in `src/lib/access.ts`, and a
  route missing from it does not typecheck; `hooks.server.ts` turns away
  anything beyond someone's level before the route runs. Where someone with
  Field reaches a route, it shows them their own work and changes only what they
  made, and nobody else's pay figure. Who has which level is changed only by
  someone with Full, and the database keeps someone active on Full.
- **It is meant to sit behind a reverse proxy**, bound to loopback with
  `HOST=127.0.0.1`, and nothing assumes the proxy is the only protection —
  the application authenticates for itself.
- **The phone keeps the screens work is done on without a signal**, in the
  service worker's cache: Today and the Time screens, the person's own entries
  not yet billed or paid, the draft invoices and their lines, trips they drove
  not yet billed, and, for someone with Full, the catalogue and stock. Each is
  a copy of its own, cut to what the task needs: what the business is owed,
  what work is worth, anyone's pay and other people's work are left out, and
  the screen as it is with a signal is never kept. The copies are emptied when
  the person signs out, when a request finds the session gone, and when the
  server has not been reached for two weeks, by which time the session has
  ended.
- **The phone keeps work not yet sent** in the capture queue, in IndexedDB:
  time, lines and their receipts, drafts, trips, stock and catalogue changes,
  waiting for a signal or refused by the server, until it is sent or discarded
  by hand. Each is stamped with whoever made it, shown only to them and sent
  only under their session. Someone else signing in on the same phone never
  sees or sends it, and signing out does not empty it, because it is work
  recorded nowhere else. Nothing else is kept.
- **`created_by` comes from the session, never the request body.** The capture
  queue is written on a phone, and a phone is not trusted to say who it is.
