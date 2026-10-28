#!/bin/sh
# build.sh — compile documents and audit them, each to print/<same path>.pdf, and say what was
# made, one line per document.
#
# Run from the project root, by whatever runs the repo's builds; press.just's `build` is this:
#
#   sh third_party/press/tools/build.sh docs/guide.typ
#   sh third_party/press/tools/build.sh docs/guide.typ docs/letter/main.typ
#
# Each document goes through stamp.sh, which stamps the page with when its content last changed
# and audits what it built, and then report.sh, which says in one line what was made: new,
# changed, unchanged or cached, pages, words where poppler is installed, size, and the stamp.
# A finding prints above that line and fails the run, with the PDF still written to look at; a
# document that does not compile made nothing to report. Given more than one document it builds every
# one, then ends with the count of what it did, and fails if any failed.
#
# --check runs the audit alone on each instead, as CI does: check.sh, which refuses to run
# without the audit's tools where a build would say it skipped them.
#
#   sh third_party/press/tools/build.sh --check docs/guide.typ
#
# --tz names the zone the stamp prints in, as PRESS_TZ does, for a runner that cannot set an
# environment variable on its command line: npm runs its scripts in cmd.exe on Windows.
#
#   sh third_party/press/tools/build.sh --tz America/Los_Angeles docs/guide.typ
#
# The typst flags are press's own: the project root is the root, and press's fonts and no
# others. --ignore-system-fonts keeps the machine's fonts out, so output cannot vary by machine;
# typst's own embedded fonts stay reachable as per-glyph fallbacks (FONTS.md).
# Run by `all` (PRESS_TALLY set), it adds each document to that run's count instead.
set -eu

usage() { echo "usage: sh <press>/tools/build.sh [--check] [--tz <zone>] <doc.typ>..." >&2; exit 2; }
check=
while [ $# -gt 0 ]; do
    case $1 in
        --check) check=1; shift ;;
        --tz) [ $# -ge 2 ] || usage; PRESS_TZ=$2; export PRESS_TZ; shift 2 ;;
        --tz=*) PRESS_TZ=${1#--tz=}; export PRESS_TZ; shift ;;
        *) break ;;
    esac
done
[ $# -gt 0 ] || usage
# press's folder, as the path this script was run by: absolute from just, relative from npm.
press=$(dirname "$(dirname "$0")")

count=
if [ -z "$check" ] && [ -z "${PRESS_TALLY:-}" ] && [ $# -gt 1 ]; then
    PRESS_TALLY=$(mktemp)
    export PRESS_TALLY
    count=1
    trap 'rm -f "$PRESS_TALLY"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
fi

rc=0
for doc in "$@"; do
    src=$(printf '%s' "$doc" | tr '\\' '/')
    src=${src#./}
    case $src in
        *.typ) ;;
        *) echo "press: $doc is not a .typ file" >&2; rc=1; continue ;;
    esac
    pdf="print/${src%.typ}.pdf"
    if [ -n "$check" ]; then
        sh "$press/tools/check.sh" "$src" "$pdf" "$press" \
            --root . --font-path "$press/fonts" --ignore-system-fonts || rc=1
        continue
    fi
    s=0
    st=$(sh "$press/tools/stamp.sh" "$src" "$pdf" \
        --root . --font-path "$press/fonts" --ignore-system-fonts) || s=$?
    if [ -n "$st" ]; then
        # What stamp.sh printed is report.sh's arguments: the status, then the stamp's words.
        # shellcheck disable=SC2086
        sh "$press/tools/report.sh" "$pdf" $st
        if [ "$s" -ne 0 ] && [ -n "${PRESS_TALLY:-}" ]; then echo audit >> "$PRESS_TALLY"; fi
    fi
    [ "$s" -eq 0 ] || rc=1
done
[ -z "$count" ] || sh "$press/tools/report.sh" --summary "$PRESS_TALLY" "$#"
exit "$rc"
