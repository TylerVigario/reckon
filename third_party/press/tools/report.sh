#!/bin/sh
# report.sh — say what `build` just made, one line per document.
#
# Invoked by press's `build` recipe, from the consumer root, with what stamp.sh printed:
#
#   sh <press_root>/tools/report.sh <pdf> <new|changed|unchanged> <updated...>
#
#   print/docs/services.pdf: changed, 8 pages, 2721 words, 171 KiB, updated 2026-10-13 10:12 PDT
#
# The stamp is shown whether or not the document prints it with updated(): a sheet that
# carries no stamp still has one in its PDF, and the build is where it can be seen.
#
# Words need poppler's pdftotext, and build must not require poppler (see check), so
# without it the words are left out rather than the build failing. Poppler specifically,
# for check's reason: other extractors disagree about the text a PDF holds.
# PRESS_PDFTOTEXT names it where PATH cannot, as for check.
#
# When PRESS_TALLY names a file, the status is also appended to it, and `all` ends with
#
#   sh <press_root>/tools/report.sh --summary <tally> <documents found>
#
# The build recipe appends "audit" for a document that failed its audit, which the summary
# counts apart; a document with no status at all did not build.
#   press: 12 documents: 2 changed, 9 unchanged, 1 failed the audit, 1 did not build
#
# A document that fails to build never reaches report.sh, so "did not build" is found minus
# tallied.
#
# A file of its own because build and all both run it, and it can be run by hand.
set -eu

if [ "$1" = --summary ]; then
    awk -v found="$3" '{ n[$1]++; if ($1 != "audit") t++ } END {
        found += 0; failed = found - t
        line = sprintf("press: %d document%s", found, found == 1 ? "" : "s")
        sep = ": "
        split("changed new unchanged", k, " ")
        for (i = 1; i <= 3; i++) if (n[k[i]]) { line = line sep n[k[i]] " " k[i]; sep = ", " }
        if (n["audit"]) line = line sep n["audit"] " failed the audit"
        if (failed > 0) line = line sep failed " did not build"
        print line
    }' "$2"
    exit 0
fi

pdf=$1
status=$2
shift 2
updated="$*"

# The page count from the PDF's page tree, which typst writes uncompressed: on one line
# from 0.15 (/Type/Pages/Count N), one key to a line before. Line ends become spaces so
# both read the same. Only the root's Count is the whole document; a nested node's is
# smaller, so the largest is taken. Left out if a future typst writes it otherwise.
pages=$(tr '\r\n' '  ' < "$pdf" | grep -a -o '/Type */Pages */Count *[0-9]*' | sed 's/.*Count *//' | sort -n | tail -n 1)

bytes=$(wc -c < "$pdf" | tr -d ' ')
size=$(awk -v b="$bytes" 'BEGIN {
    if (b < 1024) printf "%d B", b
    else if (b < 1048576) printf "%.0f KiB", b / 1024
    else printf "%.1f MiB", b / 1048576
}')

words=
PDFTOTEXT=${PRESS_PDFTOTEXT:-pdftotext}
if command -v "$PDFTOTEXT" >/dev/null 2>&1 && "$PDFTOTEXT" -v 2>&1 | grep -qi poppler; then
    words=$("$PDFTOTEXT" -enc UTF-8 "$pdf" - | wc -w | tr -d ' ')
fi

plural() { if [ "$1" = 1 ]; then echo "1 $2"; else echo "$1 ${2}s"; fi; }

line="$pdf: $status"
[ -n "$pages" ] && line="$line, $(plural "$pages" page)"
[ -n "$words" ] && line="$line, $(plural "$words" word)"
line="$line, $size, updated $updated"
printf '%s\n' "$line"

[ -n "${PRESS_TALLY:-}" ] && printf '%s\n' "$status" >> "$PRESS_TALLY"
exit 0
