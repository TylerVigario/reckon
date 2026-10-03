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
- anything that gets a password, a session token or a client's records out of
  the system
- a constraint in `db/migrations/` that can be worked around from the
  application

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

- **Sessions are database rows**, by Better Auth, so one can be revoked now.
  The cookie is the row's token signed with `BETTER_AUTH_SECRET`: a copy of the
  `session` table lets nobody in without the secret too, and changing the
  secret signs everybody out. The server will not start without one.
- **Passwords are argon2id** at the OWASP minimum, and the hash records its own
  parameters, so raising them re-hashes on the next sign-in.
- **A missing account costs the same time as a wrong password**, and both return
  the same message. Five failures from one address in fifteen minutes make that
  address wait. The limit is per address and never per account, so it says
  nothing about which addresses have one — and it is held in memory, so a
  restart forgives everyone.
- **Every response carries a content security policy.** A page gets the one
  SvelteKit writes, with its own inline code hashed. Anything else — the logo,
  the operator's stylesheet, the manifest, the API — gets one that runs nothing
  and is sandboxed, so an uploaded SVG logo opened directly cannot act as the
  site.
- **It is meant to sit behind a reverse proxy**, bound to loopback with
  `HOST=127.0.0.1`, and nothing assumes the proxy is the only protection —
  the application authenticates for itself.
- **The phone keeps Today and the Time screens** in the service worker's cache,
  as the person signed in last saw them, so they open without a signal. That
  copy is on the device until they sign out, which empties it, or until a
  request finds the session gone.
- **The phone keeps time not yet sent** in the capture queue, in IndexedDB: an
  entry waiting for a signal, and one the server refused, until it is sent or
  discarded by hand. Signing out does not empty it, because those are hours
  recorded nowhere else. Nothing else is kept.
- **`created_by` comes from the session, never the request body.** The capture
  queue is written on a phone, and a phone is not trusted to say who it is.
