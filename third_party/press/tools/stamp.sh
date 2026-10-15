#!/bin/sh
# stamp.sh — compile a document, stamped with when its content last changed.
#
# Run from the consumer root by whatever runs the repo's builds, press.just's `build`
# among them, and by check.sh for its recompile:
#
#   sh <press_root>/tools/stamp.sh <doc> <pdf> <typst flags...>
#
# On success it prints one line, which press.just's `build` hands to report.sh: what
# happened -- new (no stamped PDF was there), changed or unchanged -- then the time the page
# now carries. typst's own output goes to stderr.
#
# IT IS THE BUILD, not a wrapper around one: every runner calls it, and check.sh compiles
# through it too, so the audit reads a PDF built exactly as the build makes it.
#
# EVERY BUILD IS AUDITED. Once the PDF is written, check.sh's passes read it, with the files
# this compile read and the warnings it printed, so nothing compiles twice. A finding prints
# and fails the build, and the PDF stays written, so a runner, CI or `all` sees it and the page
# can still be looked at. Where the audit's tools are missing, the build says the audit was
# skipped and why, and succeeds: building never depends on them. check.sh's own compile is not
# audited again (PRESS_IN_CHECK).
#
# WHY A STAMP. A printed sheet goes stale without saying so. The stamp is passed in as
# sys.inputs.press-updated, and a document shows it with lib.typ's updated() — in
# its footer, so every page carries it. Comparing the shelf copy with the latest build
# then answers "reprint?" at a glance.
#
# WHY "LAST CHANGED", NOT "BUILT". A rebuild that changes nothing would otherwise move the
# time, and a newer time would say "reprint" about an identical page. So the source is
# first compiled AT the previous stamp: typst's output is deterministic for the same
# inputs and --creation-timestamp, so a byte-identical PDF means nothing on the page
# changed, and the old time stands. Only a
# difference compiles again at the current time. A different typst, or new fonts, can
# change the bytes of an unchanged page; that re-stamps it, which errs toward reprinting.
#
# The previous stamp is read from the PDF itself: --creation-timestamp puts it in the Info
# dictionary as plain text, /CreationDate(D:YYYYMMDDHHMMSSZ), in UTC. No side file to lose
# or leave behind. A PDF without one -- or built before this -- simply gets a new stamp.
#
# typst 0.14 writes a space before the date's parenthesis, and stamp_of reads either.
set -eu

src=$1
pdf=$2
shift 2
# What remains in "$@" is the typst flags, as in check.sh.

# The oldest typst press works with, from press.toml. lib.typ asserts it too, but build and
# check pass --creation-timestamp and --deps first, and an older typst stops on a flag it
# lacks, as "unexpected argument", before lib.typ is ever read.
min=$(sed -n 's/^typst *= *"\(.*\)"$/\1/p' "$(dirname "$0")/../press.toml")
v=$(typst --version) || { echo 'press: typst is not on PATH' >&2; exit 1; }
v=${v#typst }
v=${v%% *}
echo "$v" | awk -F. -v min="$min" '{
    split(min, m, ".")
    for (i = 1; i <= 3; i++) { if ($i + 0 > m[i] + 0) exit 0; if ($i + 0 < m[i] + 0) exit 1 }
}' || { echo "press: needs typst $min or newer; this is typst $v" >&2; exit 1; }

now=$(date +%s)

# The stamp is kept and compared in UTC -- the PDF's /CreationDate -- and printed in the
# DOCUMENT's time zone: PRESS_TZ, an IANA name the consuming repo sets for every build —
# exported from a justfile, set in an npm script or CI —
#
#   PRESS_TZ=America/Los_Angeles     ("UTC" for documents read across zones)
#
# so every machine prints the same text for the same moment, and an unchanged page stays
# unchanged wherever it is built. Unset, it is the building machine's own zone, and a build
# under another zone re-stamps a page that did not change.
#
# date is handed the zone's FILE, not its name. Git for Windows' date knows no names: its
# database is /mingw64/share/zoneinfo, where its date neither looks nor follows TZDIR, but it
# reads a zone file given by path, as glibc, the BSDs and macOS do. A name or path date
# cannot read is no error to date either: it prints UTC under a made-up name. So the file is
# found first, and a name with none fails the build.
zone=
if [ -n "${PRESS_TZ:-}" ]; then
    for dir in ${TZDIR:+"$TZDIR"} /usr/share/zoneinfo /mingw64/share/zoneinfo; do
        if [ -f "$dir/$PRESS_TZ" ]; then
            zone=$dir/$PRESS_TZ
            break
        fi
    done
    if [ -z "$zone" ]; then
        echo "press: PRESS_TZ is not a time zone this machine knows: $PRESS_TZ" >&2
        echo "       looked in ${TZDIR:+$TZDIR, }/usr/share/zoneinfo and /mingw64/share/zoneinfo;" >&2
        echo "       set TZDIR if this machine keeps its zones elsewhere" >&2
        exit 1
    fi
fi
tz() { if [ -n "$zone" ]; then TZ=":$zone" "$@"; else "$@"; fi; }

# Readable on paper. GNU date (Linux, Git for Windows) takes -d @N; BSD and macOS take -r N.
when() { tz date -d "@$1" '+%Y-%m-%d %H:%M %Z' 2>/dev/null || tz date -r "$1" '+%Y-%m-%d %H:%M %Z'; }

# The previous stamp, in Unix seconds, from the PDF's own /CreationDate; empty if none.
# typst 0.14 writes a space before the date's parenthesis and 0.15 none, so either is read.
# awk does the calendar arithmetic (days from civil, Hinnant) because GNU and BSD date
# disagree on how to parse a date, and this must run on both.
stamp_of() {
    grep -a -o '/CreationDate *(D:[0-9]\{14\}Z)' "$1" 2>/dev/null | head -n 1 | awk '{
        s = substr($0, index($0, "D:") + 2, 14)
        y = substr(s, 1, 4) + 0; m = substr(s, 5, 2) + 0; d = substr(s, 7, 2) + 0
        if (m <= 2) { y -= 1; m += 12 }
        era = int(y / 400); yoe = y - era * 400
        doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + int((153 * (m - 3) + 2) / 5) + d - 1
        printf "%d\n", (era * 146097 + doe - 719468) * 86400 + substr(s, 9, 2) * 3600 + substr(s, 11, 2) * 60 + substr(s, 13, 2)
    }'
}

# The audit's working files: the files the compile read, and what typst printed.
work=$(mktemp -d "${TMPDIR:-/tmp}/press-build.XXXXXX")
trial=
trap 'rm -rf "$work"; if [ -n "$trial" ]; then rm -f "$trial"; fi' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[ -n "${PRESS_IN_CHECK:-}" ] || set -- "$@" --deps "$work/deps" --deps-format zero

# finish <status> <typst flags...>: say what typst printed and what the build made, then audit
# it, and exit with the audit's answer.
finish() {
    st=$1
    shift
    [ -n "$out" ] && printf '%s\n' "$out" >&2
    printf '%s\n' "$st"
    [ -z "${PRESS_IN_CHECK:-}" ] || exit 0
    printf '%s\n' "$out" > "$work/log"
    here=$(dirname "$0")
    PRESS_AUDIT=optional PRESS_BUILT_DEPS="$work/deps" PRESS_BUILT_LOG="$work/log" \
        sh "$here/check.sh" "$src" "$pdf" "$here/.." "$@"
    exit $?
}

# Compile $src at stamp $1 into $2; typst's own output goes to stdout for the caller.
at() {
    e=$1; o=$2; shift 2
    typst compile "$@" --input "press-updated=$(when "$e")" --creation-timestamp "$e" "$src" "$o" 2>&1
}

mkdir -p "$(dirname "$pdf")"

# A copy at another PDF's stamp (PRESS_STAMP_AS): check's copy with every scan hidden, which
# must lay out exactly as the document's PDF does, stamp and all. No comparison, no audit.
if [ -n "${PRESS_STAMP_AS:-}" ]; then
    e=$(stamp_of "$PRESS_STAMP_AS")
    [ -n "$e" ] || e=$now
    out=$(at "$e" "$pdf" "$@") || { printf '%s\n' "$out" >&2; exit 1; }
    exit 0
fi

old=$( [ -f "$pdf" ] && stamp_of "$pdf" || true )
if [ -n "$old" ]; then
    # typst takes the format from the extension, so the trial build keeps .pdf. It sits in
    # print/, so an interrupt mid-compile removes it rather than leaving it there.
    trial="${pdf%.pdf}.press-trial.$$.pdf"
    if out=$(at "$old" "$trial" "$@"); then
        if cmp -s "$trial" "$pdf"; then
            rm -f "$trial"
            finish "unchanged $(when "$old")" "$@"
        fi
    else
        rm -f "$trial"
        printf '%s\n' "$out" >&2
        exit 1
    fi
    rm -f "$trial"
fi

if out=$(at "$now" "$pdf" "$@"); then
    finish "$( [ -n "$old" ] && echo changed || echo new ) $(when "$now")" "$@"
fi
printf '%s\n' "$out" >&2
exit 1
