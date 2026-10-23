#!/bin/sh
# watch.sh — recompile one document on every save, to print/<same path>.watch.pdf
#
# Run from the project root, by whatever runs the repo's builds; press.just's `watch` is this:
#
#   sh third_party/press/tools/watch.sh docs/guide.typ
#
# A preview, beside the PDF build.sh makes rather than over it. typst watch passes no stamp, so
# writing over print/<doc>.pdf would leave a PDF whose date stamp.sh cannot read, and the next
# build would re-stamp a page that never changed, saying "reprint" about it. The preview's
# footer says it is not stamped; build.sh makes the copy to print. It is not audited.
set -eu

[ $# -eq 1 ] || { echo "usage: sh <press>/tools/watch.sh <doc.typ>" >&2; exit 2; }
press=$(dirname "$(dirname "$0")")
src=$(printf '%s' "$1" | tr '\\' '/')
src=${src#./}
case $src in
    *.typ) ;;
    *) echo "press: $1 is not a .typ file" >&2; exit 1 ;;
esac
pdf="print/${src%.typ}.watch.pdf"
mkdir -p "$(dirname "$pdf")"
exec typst watch --root . --font-path "$press/fonts" --ignore-system-fonts "$src" "$pdf"
