#!/bin/sh
# all.sh — compile and audit every document under the given directories (default docs/), not
# the files they are made of, then say what the run did.
#
# Run from the project root, by whatever runs the repo's builds; press.just's `all` is this:
#
#   sh third_party/press/tools/all.sh                              -> docs/
#   sh third_party/press/tools/all.sh recipes protocols concerns   -> those three
#
# The default is a convenience, not a required layout. press claims to be additive rather than
# governing, and a build that only walks docs/ would quietly make that false: a repo organised by
# meaning rather than by kind should not have to restructure, or write its own `all`, to use this.
#
# DOCUMENTS, NOT THE FILES THEY ARE MADE OF. A document can #include chapters or #import a file of
# its own definitions, and those compiled on their own fail or print a stray page. So two kinds of
# .typ file are parts, not documents, and are not built:
#
#   · one whose name starts with _ — docs/_shared.typ, imported by several documents;
#   · any file in a directory that holds a main.typ, other than that main.typ, at any depth
#     below it — the shape new.sh makes, docs/book/main.typ beside its chapters.
#
# Nor is anything in press's own folder, a directory holding press.toml, which `all .` would
# otherwise reach: its library is no document, its starters are copied before they are built,
# and its calibration sheet is built by name when a printer is being checked.
#
# A directory named on the command line is a place to look, not a document, so a main.typ
# directly inside one (docs/main.typ) makes nothing else in it a part.
#
# Each document is built by build.sh, every one even after one fails, and the run fails if any
# did. It fails loudly on finding no document rather than reporting a green build that produced
# nothing: the state a repo is in before it has adopted any layout, and the one where a false
# success is most expensive. It ends with a count of what the run did (changed, new, unchanged,
# cached, failed), from the status each build adds to the file PRESS_TALLY names.
#
# --check audits every one instead, refusing without the audit's tools, and --tz names the
# stamp's zone, as build.sh takes them.
set -eu

press=$(dirname "$(dirname "$0")")
usage() { echo "usage: sh <press>/tools/all.sh [--check] [--tz <zone>] [<dir>...]" >&2; exit 2; }
check=
while [ $# -gt 0 ]; do
    case $1 in
        --check) check=--check; shift ;;
        --tz) [ $# -ge 2 ] || usage; PRESS_TZ=$2; export PRESS_TZ; shift 2 ;;
        --tz=*) PRESS_TZ=${1#--tz=}; export PRESS_TZ; shift ;;
        *) break ;;
    esac
done
[ $# -gt 0 ] || set -- docs
for d in "$@"; do
    test -d "$d" || { echo "press: no such directory: $d" >&2; exit 1; }
done

docs=$(mktemp)
PRESS_TALLY=$(mktemp)
export PRESS_TALLY
trap 'rm -f "$docs" "$PRESS_TALLY"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

roots=$(printf '%s\n' "$@" | sed 's#/*$##')
find "$@" \( -name '*.typ' -o -name press.toml \) -type f | LC_ALL=C sort | ROOTS=$roots awk '
    BEGIN { n = split(ENVIRON["ROOTS"], r, "\n"); for (i = 1; i <= n; i++) root[r[i]] = 1 }
    /(^|\/)press\.toml$/ { d = $0; sub(/\/?press\.toml$/, "", d); kit[d == "" ? "." : d] = 1; next }
    { f[++k] = $0
      if ($0 ~ /\/main\.typ$/) { d = $0; sub(/\/main\.typ$/, "", d); if (!(d in root)) proj[d] = 1 } }
    END {
        for (i = 1; i <= k; i++) {
            base = f[i]; sub(/.*\//, "", base)
            if (base ~ /^_/) continue
            part = 0
            for (p in kit) if (index(f[i], p "/") == 1) { part = 1; break }
            for (p in proj) if (index(f[i], p "/") == 1 && f[i] != p "/main.typ") { part = 1; break }
            if (!part) print f[i]
        }
    }' > "$docs"
n=$(wc -l < "$docs" | tr -d ' ')
test "$n" -gt 0 || { echo "press: no documents in: $*" >&2; exit 1; }

# The loop's own status would be only its last document's, so each build's is kept.
rc=0
while IFS= read -r doc; do
    # shellcheck disable=SC2086  # $check is --check or nothing
    sh "$press/tools/build.sh" $check "$doc" < /dev/null || rc=1
done < "$docs"
[ -n "$check" ] || sh "$press/tools/report.sh" --summary "$PRESS_TALLY" "$n"
exit "$rc"
