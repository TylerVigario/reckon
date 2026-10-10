# Rulesets

Branch and tag protection, committed. A ruleset is state that lives only on the
forge: it vanishes on repository recreate, rename or fork, and nothing in a
clone reveals that it is gone. Committing the payload makes a change to
protection a change to the repository, reviewable like any other.

Applied state is a copy of these files, not the other way round.

## `main.json`

Six rules. Four say who may write the branch — `deletion`, `non_fast_forward`,
`pull_request`, `required_linear_history` — and two say what must be true before
a merge: every assertion CI makes, each as its own context, and no new CodeQL
finding.

`allowed_merge_methods` is `squash` alone. That is not the same lever as
disabling the other merge methods in settings: a setting is re-enabled by one
call and leaves nothing behind, and this is in the tree.

The required contexts are **`Schema`, `Typecheck`, `Format`, `Lint`, `Unit`,
`Behaviour`, `Build`, `Validate PR title`** — job names, exactly. One per
assertion CI makes, which is what makes coverage hard to lose: removing an
assertion means removing its job, and the context then names nothing and wedges
the branch, so the removal cannot complete without editing this file. A context
naming no job wedges it the same way by accident, so renaming a job means
editing this file in the same change.

`code_scanning` refuses a pull request that introduces a CodeQL error, or a
security finding of medium or higher. It reads the analysis rather than a job,
which is why the CodeQL jobs are not among the required contexts. Like a
required context, it is applied only once the thing behind it can answer — after
CodeQL has analysed `main` — or every pull request waits on an analysis that
never comes.

## `tags.json`

`update` is the one that matters. Without it a tag can be moved to a different
commit, which makes a published version mean whatever the tag currently points
at rather than what was released under it.

## One bypass actor

`main.json` names the **`reckon-release` App (id 4892247)**, owned by this
account and installed on this repository. It exists for one reason: a release
records itself, which means writing the default branch, which nothing else may
do.

Its blast radius is the App's own permissions, and those are `contents: write`
and `metadata: read`. Notably absent is any `workflows` scope, so the actor that can
write the branch cannot rewrite what runs on it.

An App and not an actor _type_: a type would exempt every automation acting in
that role, which is the whole population the rule constrains.

The App has to be installed before this file is applied, because **a bypass
naming an actor the forge cannot resolve fails the entire payload**, not
just that entry — a ruleset can then read as applied while enforcing nothing,
required status checks included.

## `required_signatures` is deliberately absent

Every commit on the default branch is already signed by the forge, because
nothing else reaches it: a squash the forge built from a pull request, or a
commit an App asked it to write. `required_signatures` is a contributor gate —
it refuses a merge when the pull request's own commits are unsigned, and those
commits are discarded by the squash without ever reaching the branch it
protects. Nobody is turned away over a key.
