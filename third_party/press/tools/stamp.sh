#!/bin/sh
# stamp.sh — compile a document, stamped with when its content last changed.
#
# Run from the consumer root by build.sh, which any runner calls, and by check.sh for its
# recompile:
#
#   sh <press_root>/tools/stamp.sh <doc> <pdf> <typst flags...>
#
# On success it prints one line, which build.sh hands to report.sh: what
# happened -- new (no stamped PDF was there), changed, unchanged (built again, the same bytes)
# or cached (the build record matched, so nothing was built) -- then the time the page now
# carries. typst's own output goes to stderr.
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

# The oldest typst press works with, from press.toml. lib/tokens.typ asserts it too, but build
# and check pass --creation-timestamp and --deps first, and an older typst stops on a flag it
# lacks, as "unexpected argument", before press is ever read.
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
        echo "press: PRESS_TZ (or --tz) is not a time zone this machine knows: $PRESS_TZ" >&2
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

# THE BUILD RECORD. A PDF is unchanged only if nothing it was made from changed, and that is
# known without compiling it. One file in press's own folder, .build-record, holds an entry per
# document and PDF: what its last build read -- every file typst lists, the fonts in each font
# path (typst does not list fonts), the typst version, press's tools, the flags, the zone --
# with a SHA-256 of each, the PDF's own, its stamp, and what the audit said. When all of it still
# matches, the build says cached without compiling or auditing again, and repeats what the
# audit said. Only a build whose audit ran every pass and passed is recorded: one that failed, or
# skipped anything for want of a tool, has its entry removed, so the next build audits again.
#
# The record is a cache. press's .gitignore keeps it out of git, an update replaces press's
# folder and the record with it, and deleting it costs one full build per document, never a
# wrong answer. A record press cannot write leaves the build as it was. check.sh, the audit asked
# for by name, never uses it. Two builds at once each write a whole new record and the later
# one stands, which costs the other document a rebuild.
here=$(dirname "$0")
record=$here/../.build-record
entry_head=$(printf '== %s\t%s' "$src" "$pdf")
# entry: this document's entry from the record, without its heading.
entry() { [ -f "$record" ] && awk -v h="$entry_head" '$0 == h { on = 1; next } /^== / { on = 0 } on' "$record"; }
# others: the record without this document's entry.
others() {
    if [ -f "$record" ]; then
        awk -v h="$entry_head" '/^== / { on = ($0 != h) } NR == 1 || on' "$record"
    else
        echo "press build record 1"
    fi
}
# write_record: replace the record with what is on stdin, whole, or leave it if press's folder
# cannot be written.
write_record() { cat > "$record.$$" 2>/dev/null && mv "$record.$$" "$record" 2>/dev/null || rm -f "$record.$$" 2>/dev/null || true; }
if command -v sha256sum >/dev/null 2>&1; then dig=sha256sum; else dig="shasum -a 256"; fi
# fontdirs <typst flags...>: the font paths a build reads, from the flags and the environment.
fontdirs() {
    want=
    for a in "$@"; do
        if [ -n "$want" ]; then printf '%s\n' "$a"; want=; continue; fi
        case $a in
            --font-path) want=1 ;;
            --font-path=*) printf '%s\n' "${a#--font-path=}" ;;
        esac
    done
    if [ -n "${TYPST_FONT_PATHS:-}" ]; then printf '%s\n' "$TYPST_FONT_PATHS" | tr ':;' '\n\n'; fi
}
# key <typst flags...>: what the build depends on besides the files typst lists.
key() {
    echo "typst $(typst --version)"
    printf 'flags'; printf ' %s' "$@"; echo
    echo "zone $zone"
    echo "env ${TYPST_ROOT-}|${TYPST_FONT_PATHS-}|${TYPST_IGNORE_SYSTEM_FONTS-}"
    # shellcheck disable=SC2086  # $dig is a command and its arguments
    $dig "$here/stamp.sh" "$here/check.sh" "$here/ink-margin.py" "$here/line-overlap.py" | sed 's/^/tool /'
    fontdirs "$@" | while IFS= read -r d; do
        [ -d "$d" ] && find "$d" -type f \( -name '*.[ot]tf' -o -name '*.tt[c]' -o -name '*.ot[c]' \)
    done | LC_ALL=C sort | tr '\n' '\000' | xargs -0 $dig 2>/dev/null | sed 's/^/font /'
}
if [ -z "${PRESS_IN_CHECK:-}" ] && [ -z "${PRESS_STAMP_AS:-}" ]; then
    key "$@" > "$work/key"
    entry > "$work/entry" || true
    if [ -s "$work/entry" ] && [ -f "$pdf" ]; then
        # shellcheck disable=SC2086
        { cat "$work/key"; echo "pdf $($dig "$pdf" | cut -d ' ' -f 1)"; } > "$work/now"
        sed -n 's/^input //p' "$work/entry" > "$work/inputs"
        # shellcheck disable=SC2086
        if head -n "$(wc -l < "$work/now")" "$work/entry" | cmp -s - "$work/now" \
                && [ -s "$work/inputs" ] && $dig -c --status "$work/inputs" 2>/dev/null; then
            sed -n 's/^note //p' "$work/entry" >&2
            printf 'cached %s\n' "$(when "$(sed -n 's/^stamp //p' "$work/entry")")"
            exit 0
        fi
    fi
    if [ -s "$work/entry" ]; then others | write_record; fi
fi
[ -n "${PRESS_IN_CHECK:-}" ] || set -- "$@" --deps "$work/deps" --deps-format zero

# finish <status> <stamp> <typst flags...>: say what typst printed and what the build made,
# then audit it; record the build if the audit passed, and exit with the audit's answer.
finish() {
    st=$1 stamp=$2
    shift 2
    [ -n "$out" ] && printf '%s\n' "$out" >&2
    printf '%s %s\n' "$st" "$(when "$stamp")"
    [ -z "${PRESS_IN_CHECK:-}" ] || exit 0
    printf '%s\n' "$out" > "$work/log"
    s=0
    PRESS_AUDIT=optional PRESS_BUILT_DEPS="$work/deps" PRESS_BUILT_LOG="$work/log" PRESS_AUDIT_RAN="$work/ran" \
        sh "$here/check.sh" "$src" "$pdf" "$here/.." "$@" 2> "$work/notes" || s=$?
    cat "$work/notes" >&2
    [ "$s" -eq 0 ] || exit "$s"
    [ -f "$work/ran" ] || exit 0
    # shellcheck disable=SC2086
    {
        others
        printf '%s\n' "$entry_head"
        cat "$work/key"
        echo "pdf $($dig "$pdf" | cut -d ' ' -f 1)"
        echo "stamp $stamp"
        tr '\000\\' '\n/' < "$work/deps" | while IFS= read -r f; do
            if [ -n "$f" ] && [ -f "$f" ]; then printf '%s\000' "$f"; fi
        done | xargs -0 $dig | sed 's/^/input /'
        sed 's/^/note /' "$work/notes"
    } | write_record
    exit 0
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
            finish unchanged "$old" "$@"
        fi
    else
        rm -f "$trial"
        printf '%s\n' "$out" >&2
        exit 1
    fi
    rm -f "$trial"
fi

if out=$(at "$now" "$pdf" "$@"); then
    finish "$( [ -n "$old" ] && echo changed || echo new )" "$now" "$@"
fi
printf '%s\n' "$out" >&2
exit 1
