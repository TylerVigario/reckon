#!/bin/sh
# new.sh — scaffold a new document from a press template, importing press from where it sits.
#
# Run from the project root, by whatever runs the repo's builds:
#
#   sh third_party/press/tools/new.sh docs/thing           -> docs/thing/main.typ
#   sh third_party/press/tools/new.sh docs/thing letter    -> the same, from the letter template
#
# The second word names a starter in press's template/: main by default, letter, recipe or
# resume.
#
# The name is a directory, so it takes no .typ: a document grows chapters beside its
# main.typ. The template imports press relatively, so it compiles where it stands; the copy
# imports press by its path from the project root (/third_party/press/lib.typ), which is the
# form a document anywhere under the root can use. press must sit under the root, since typst
# reads no file outside it.
set -eu

[ $# -eq 1 ] || [ $# -eq 2 ] || { echo "usage: sh <press>/tools/new.sh <directory> [starter]" >&2; exit 2; }
n=$(printf '%s' "$1" | tr '\\' '/')
n=${n%/}
case $n in
    /* | [A-Za-z]:*)
           echo "press: name the new directory relative to the project root, not as $n" >&2
           exit 1 ;;
    *.typ) echo "press: new makes a directory holding main.typ, so name it without .typ: ${n%.typ}" >&2
           exit 1 ;;
esac
[ ! -e "$n" ] || { echo "press: $n already exists" >&2; exit 1; }

# press's directory, as the path this script was run by, compared logically with the root:
# `cd ... && pwd` gives both in the shell's own form, so a symlinked directory above press and
# Windows' C:/ paths line up.
press=$(dirname "$0")/..
t=${2:-main}
case $t in
    *[!a-z]* | '') t= ;;
esac
if [ -z "$t" ] || [ ! -f "$press/template/$t.typ" ]; then
    echo "press: there is no ${2:-} template; press has: $(cd "$press/template" && ls -- *.typ | sed 's/\.typ$//' | tr '\n' ' ')" >&2
    exit 1
fi
root=$(pwd)
here=$(cd "$press" && pwd)
case $here in
    "$root")   at= ;;
    "$root"/*) at=${here#"$root"} ;;
    *) echo "press: press sits outside this project root ($here); typst reads no file outside" >&2
       echo "       the root, so move press under it or run this from a root that contains it" >&2
       exit 1 ;;
esac
import="$at/lib.typ"

mkdir -p "$n"
esc=$(printf '%s' "$import" | sed 's/[&#\\]/\\&/g')
sed "s#^\\#import \"\\.\\./lib\\.typ\": \\*#\\#import \"$esc\": *#" "$press/template/$t.typ" > "$n/main.typ"
grep -q "^#import \"$import\": \\*" "$n/main.typ" \
    || { echo "press: the template's import line was not where new.sh expects it" >&2; exit 1; }
if [ "$t" = main ]; then echo "press: made $n/main.typ, importing press from $import"
else echo "press: made $n/main.typ from the $t template, importing press from $import"; fi
