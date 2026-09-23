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
- the real client names, addresses and rates throughout the repository. Those
  are published deliberately — see `docs/decisions.md` — and are not a
  disclosure
- dependency advisories with no path to exploitation here. Report them, but
  they are triaged as maintenance

## What this project already assumes

Worth knowing before reporting, because these are decisions rather than
oversights:

- **Sessions are database rows, not signed tokens.** Only the SHA-256 of the
  cookie is stored, so a copy of the `session` table does not let anyone in.
  There is no signing key, so there is nothing to rotate.
- **Passwords are argon2id** at the OWASP minimum, and the hash records its own
  parameters, so raising them re-hashes on the next sign-in.
- **A missing account costs the same time as a wrong password**, and both return
  the same message. Five failures lock the account for fifteen minutes.
- **The application binds to loopback.** It is reached through a reverse proxy,
  and nothing about the deployment assumes the proxy is the only protection —
  the application authenticates for itself.
- **`created_by` comes from the session, never the request body.** The capture
  queue is written on a phone, and a phone is not trusted to say who it is.
