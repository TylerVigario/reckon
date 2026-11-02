#!/bin/sh
# check.sh — audit a built document for what typst lets through without a word: warnings that
# exit 0, fonts that are not vendored, glyphs that vanish, ink too near the edge, text on text.
#
# Run from the consumer root by build.sh --check, which any runner calls, and by stamp.sh after
# every build:
#
#   sh <press_root>/tools/check.sh <doc> <pdf> <press_root> <typst flags...>
#
# Paths are relative to the consumer root, which is why it runs there and takes
# press_root separately — the two are the same directory only when press is being
# used on itself.
#
# Two of these checks exist because there are two ways to lose a glyph, and
# neither warns.
#
#   SUBSTITUTED — the codepoint is missing from every vendored face, so typst
#   draws it from one of its OWN embedded fonts. Measured on press:
#   ✓ ✗ ▸ come from NewCMMath, ⚠ ⚡ ☐ from DejaVuSansMono, ℹ from
#   LibertinusSerif. The page looks almost right and the species is wrong.
#
#   VANISHED — no font anywhere has it, so it is dropped from the page AND from
#   the extracted text. Measured: ⛔ and 📋 disappear outright. This is the worse
#   half: a substitution ships the wrong glyph, a disappearance ships missing
#   content, and a printed sheet cannot be diffed against anything.
#
# The WARNINGS check reads typst's own output. typst exits 0 on warnings and has no
# deny-warnings flag, so a warning ships unless something reads it — markdown
# `**bold**` silently renders as nothing, an unknown font family falls back. It
# recompiles and fails on any warning, which is the only enforcement available.
#
# The FONT check catches substitution by listing embedded faces that are not
# vendored here. The GLYPH check catches disappearance by rendering each
# non-ASCII character from the source in ISOLATION and asking whether it survived.
#
# The glyph check probes rather than reading the document's own text layer, because
# that layer lies. In `A ⛔ B 📋 C` with neither symbol drawable, only the FIRST
# unmapped character is dropped from the extracted text; the rest remain in it
# and read back as present. A whole-document scan therefore reports one missing
# glyph when there are five. Isolating one candidate per probe makes each the
# first, and the answer truthful.
#
# The vendored family list is derived by subtracting `typst fonts` without a
# --font-path (typst's own embedded faces) from the same command with one, so
# it stays correct when typst changes what it bundles.
#
# LIMITS, stated because a check trusted past its reach is worse than none:
#   · `#sym.checkmark` and friends carry no source codepoint, so the glyph check
#     cannot see them — the font check still catches the substitution they cause.
#   · A probe asks whether a character survives at all — drawn by a vendored face
#     or by one of typst's own embedded faces — not whether THIS document's face
#     draws it, and it never looks at the document's page. So a character in a
#     trailing comment is probed like any other, and reported only if nothing can
#     draw it (full-line `//` comments are skipped). A glyph drawn from an embedded
#     face, or present only in the mono face, is the font check's to report.
#   · Space separators and format characters are not probed at all. Nothing is
#     drawn for them, so "did it survive" has no answer, and pdftotext hands
#     back a plain space for U+00A0 — which read as vanished and failed correct
#     documents. A stray invisible character in source is a real fault; it is
#     just not this pass's to report.
#   · Needs poppler — pdffonts, pdftotext AND pdftoppm, all three — and poppler
#     specifically for the first two: Xpdf and mupdf ship programs of those names
#     that disagree about which glyphs a PDF contains, so check asserts the
#     implementation rather than the name. pdftoppm carries no such assertion:
#     Git for Windows bundles no pdftoppm at all, so on Windows it is an absence
#     problem. Xpdf ships one too, and press has not been run against it.
#     That is also why a build skips a pass whose tools are missing and says so,
#     where check refuses: building must not require any of it.
#     Set PRESS_PDFTOTEXT / PRESS_PDFFONTS to point at them directly where PATH
#     cannot be made to resolve poppler first — on Windows it cannot, because
#     Git's sh prepends its own bin directories at startup and the Xpdf copies
#     bundled there win inside every tool. The assertion still applies to
#     whatever the variables name.
#   · The overlap check sees GLYPHS ONLY. Text printed over a coloured panel, or
#     a rule struck through a line, is invisible to it — those are ink-on-ink,
#     and what would distinguish them is not in the text layer. Nothing cheap
#     covers that case; the printable-area check does not either, because ink in
#     the middle of a page is not its question.
#   · Rotated text is the overlap check's soft spot. Poppler segments rotated
#     glyphs into fragments and reports them as separate lines, which reads as a
#     small phantom overlap — worst measured 0.13pt against a smallest genuine
#     collision of 2.72pt. The 0.5pt floor exists for that gap and nothing else,
#     so a document leaning heavily on rotation deserves a look by eye.
#   · The printable-area check additionally needs a Python and poppler's
#     pdftoppm, and is skipped with a message rather than failing when no
#     interpreter is found. PRESS_PYTHON and PRESS_PDFTOPPM name either
#     directly. The interpreter is found by EXECUTING a candidate, not by
#     resolving a name — Windows ships a zero-byte python3 alias that answers
#     `command -v` and then prints a Store advert, and turning that alias off
#     leaves a working `python` and no `python3`. A name-based guard failed
#     both ways: it ran a stub that could not work, and skipped where a working
#     interpreter was present under the other name.
#
# The PRINTABLE-AREA check verifies that no ink comes within 0.48in of a paper
# edge — the 0.5in safe area the page presets are built around, less a rendering
# tolerance.
#
# The OVERLAP check reports any line of text printed on top of another. It and
# the printable-area check catch LAYOUT faults rather than font ones, and they
# take opposite instruments for a reason worth stating: the printable-area check
# renders the page, because "is there ink near the edge" needs no layering, and
# it must see panels and rules as well as glyphs. The overlap check cannot render,
# because layering is the whole question — two lines drawn on each other and one
# line drawn once are the same pixels. It reads pdftotext's line geometry, where
# that information survives.
set -eu

src=$1
pdf=$2
press_root=$3
shift 3
# What remains in "$@" is the typst flags, passed through to stamp.sh rather than
# rebuilt here, so the audit compiles exactly as the build does.

# Run by stamp.sh, every build is audited too (PRESS_AUDIT=optional). There the PDF was just
# written, and stamp.sh hands over the files its compile read and what typst printed
# (PRESS_BUILT_DEPS, PRESS_BUILT_LOG), so nothing compiles twice. A tool the audit lacks is
# then one line saying the audit was skipped and why, not a failure: building never depends
# on these tools, and check itself still refuses without them. press's marks, which need only
# typst, are read before the tools are asked for, so a build without them still counts the open
# items and still fails while the measuring grid is on: skip ends with the status so far.
optional=
[ "${PRESS_AUDIT:-}" != optional ] || optional=1
skip() {
    echo "press: $pdf is not audited: $1; run check for the details" >&2
    exit "$rc"
}

# The vendored families, from the font files' names; fonts/ also holds their licences.
allow=$(for f in "$press_root"/fonts/*.[ot]tf; do basename "$f"; done \
          | sed 's/-[A-Za-z]*\.[to]tf$//;s/\.[to]tf$//' | sort -u | paste -sd'|' -)
rc=0
# One temporary directory for every pass, made before any of them and removed however the
# run ends. An interrupt exits, and the EXIT trap removes it: a trap on INT that only removed
# it would let the script carry on without it, into a "does not compile" or a false MISSING.
tmp=$(mktemp -d "${TMPDIR:-/tmp}/press.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Recompile FIRST, and keep the compiler's own status.
#
# Every check below reads $pdf, so the recompile has to happen before any of them or
# they audit whatever build last left there. Ordering it after the printable-area
# check meant that one alone judged a different artifact than the font checks: a
# source edited to paint ink 0.05in from the edge was reported clean, because the
# margins were measured on the previous build and the fresh PDF was written after.
# That is the check whose whole justification is that the fault is invisible until
# it is on paper.
#
# And the status must come from typst, not from the grep reading its output. Piping
# into grep hands $? to grep, so a source that did not compile at all left the old
# PDF in place, produced error: lines that no warning: filter matched, and every
# pass then passed the stale artifact — the build failing while the audit said clean.
#
# Through stamp.sh, as the build does: a bare typst compile here would overwrite the
# stamped PDF with an unstamped one, and every check would wipe the edition off the page.
# It also writes the files the compile read, for the glyph check at the end.
#
# After a build (PRESS_BUILT_DEPS), the build just did this, and its record is used.
if [ -n "${PRESS_BUILT_DEPS:-}" ]; then
    cp "$PRESS_BUILT_DEPS" "$tmp/deps"
    out=$(cat "$PRESS_BUILT_LOG")
else
    out=$(PRESS_IN_CHECK=1 sh "$press_root/tools/stamp.sh" "$src" "$pdf" "$@" --deps "$tmp/deps" --deps-format zero 2>&1) || {
        echo "press: $src does not compile —" >&2
        printf '%s\n' "$out" | sed 's/^/  /' >&2
        exit 1
    }
fi
# The document's own sources, which the glyph check probes and which may accept findings:
# every .typ the document is made of, not only $src, since text in a file it #includes or
# #imports is on the page too. typst lists what the compile read. Two kinds of file are left
# out, since their characters are their own business, not the page's:
#
#   · press's own: the lib.typ beside press.toml, which press reads on every import, and the
#     files in the lib/ beside it — and only those, so a document kept in press's directory,
#     such as its calibration sheet, is still scanned;
#   · a Typst package's files: a package lists its typst.toml with them, so anything under
#     a directory holding one is the package's.
#
# Files read as data (yaml, csv, ...) are not scanned.
#
# The paths are typst's own, separators turned to /. On Linux they are relative to the
# root. typst on Windows writes a package's files relative with mixed separators, and the
# document's own as \\?\C:\... verbatim paths, which reach grep as //?/C:/... and Git's sh
# reads as they are. A package's files and its typst.toml come in the same form, so the
# prefix that drops them lines up. Nothing compares a path with the root or the cwd.
tr '\000\\' '\n/' < "$tmp/deps" | awk '
    { f[++n] = $0 }
    /\/typst\.toml$/ { p = $0; sub(/typst\.toml$/, "", p); pkg[p] = 1 }
    /(^|\/)press\.toml$/ { p = $0; sub(/press\.toml$/, "", p); press[p] = 1 }
    END {
        for (i = 1; i <= n; i++) {
            if (f[i] !~ /\.typ$/) continue
            skip = 0
            for (p in press) if (f[i] == p "lib.typ" || index(f[i], p "lib/") == 1) skip = 1
            for (p in pkg) if (index(f[i], p) == 1) skip = 1
            if (!skip) print f[i]
        }
    }' > "$tmp/sources"
# At least $src itself; an empty list would skip the check and report the document clean.
test -s "$tmp/sources" || { echo "press: typst listed no sources for $src" >&2; exit 1; }

# PRESS'S MARKS. Two of press's parts leave a mark for the audit: unsourced(), a value the
# document prints without having read it from a source, marked with its kind, and form(probe:),
# the measuring grid. typst lists them, and only where a source of the document's own names one,
# as unsourced or probe:, so no other document is compiled again: typst eval, or typst query
# before 0.15, which has no eval. Neither takes the --deps a build passes, so the query runs
# without it. Any mention of unsourced asks, a shorthand's `unsourced.with(...)` among them: a
# query too many costs a compile, and one too few would leave a document's open items uncounted.
#
# Open items and estimates are counted, not failed: a draft carries them, and the count is what
# keeps one from going out unnoticed. A missing value is not counted: nothing is left to do. The
# measuring grid fails the audit while it is on: it is for reading where a form's blanks are, and
# a page that still carries it is not finished.
press_marks() {
    n=$#
    i=0
    while [ "$i" -lt "$n" ]; do
        a=$1; shift; i=$((i + 1))
        case $a in
            --deps | --deps-format) shift; i=$((i + 1)); continue ;;
            --deps=* | --deps-format=*) continue ;;
        esac
        set -- "$@" "$a"
    done
    typst eval 'query(metadata).map(m => m.value).filter(v => type(v) == str and v.starts-with("press-"))' \
        --in "$src" "$@" 2>/dev/null && return
    typst query "$@" "$src" metadata --field value 2>/dev/null
}
want=$(while IFS= read -r f; do
    if grep -q 'unsourced' "$f"; then echo unsourced; fi
    if grep -q 'probe:' "$f"; then echo probe; fi
done < "$tmp/sources")
if [ -n "$want" ]; then
    if marks=$(press_marks "$@"); then
        n=$(printf '%s\n' "$marks" | grep -o '"press-open"' | wc -l | tr -d ' ')
        case $n in
            0) ;;
            1) echo "press: $pdf has 1 open item for its owner to supply" >&2 ;;
            *) echo "press: $pdf has $n open items for its owner to supply" >&2 ;;
        esac
        n=$(printf '%s\n' "$marks" | grep -o '"press-estimate"' | wc -l | tr -d ' ')
        case $n in
            0) ;;
            1) echo "press: $pdf prints 1 estimate, a figure guessed, not read from a source" >&2 ;;
            *) echo "press: $pdf prints $n estimates, figures guessed, not read from a source" >&2 ;;
        esac
        if printf '%s\n' "$marks" | grep -qF '"press-probe"'; then
            echo "press: $pdf has the measuring grid on; take form()'s probe: off once its blanks are measured" >&2
            rc=1
        fi
    else
        case $want in
            *unsourced*) echo "press: could not count the open items and estimates in $pdf" >&2 ;;
        esac
        case $want in
            *probe*) echo "press: could not tell whether $pdf has the measuring grid on" >&2; rc=1 ;;
        esac
    fi
fi

# The glyph check needs a grep that speaks PCRE, honours the (*UTF) verb, and knows
# \p{...} properties. Assert it here rather than relying on the pipeline to complain:
# $? in `a | b | sort` belongs to sort, so a grep that rejects any of the three leaves
# the character list empty and the check skips itself while check goes on to report
# the document clean. Probing once, up front, is the difference between an unmet
# dependency and a check that quietly does nothing.
#
# GNU grep has all three; macOS's BSD grep has no -P at all. PRESS_GREP names another,
# as PRESS_PDFTOTEXT names a pdftotext: on macOS, `brew install grep` and PRESS_GREP=ggrep.
#
# The probe is the construct itself, not a proxy for it: a literal U+00A0 must match
# the same class the extraction filters on. Without (*UTF) that is two bytes and the
# anchored single-character class cannot match; without properties grep errors outright.
# One assertion, and it fails for either missing piece.
GREP=${PRESS_GREP:-grep}
printf '\302\240\n' | "$GREP" -qP '(*UTF)^[\p{Z}\p{Cf}]$' 2>/dev/null \
    || { [ -z "$optional" ] || skip "$GREP has no PCRE with (*UTF) and \\p{...}"
         echo "press: check needs a grep whose PCRE supports the (*UTF) verb and \\p{...} properties;" >&2
         echo "       $GREP does not. GNU grep does: on macOS, brew install grep and set PRESS_GREP=ggrep." >&2
         exit 1; }
# Poppler specifically, not merely a program answering to that name.
#
# pdftotext and pdffonts are also shipped by Xpdf and mupdf, and they do not agree.
# Measured over one document: Xpdf's default output encoding is Latin-1, which loses
# every non-ASCII character — so every glyph looks missing, and the glyph check
# accuses a correct document sixteen times over. mupdf's copy reports a different
# set again. The extractor is not an implementation detail here; it is the
# instrument the verdict is read off, and three instruments give three verdicts
# on identical input.
#
# This matters most where it is least visible: Git for Windows bundles Xpdf's
# pdftotext in mingw64/bin and Git Bash puts that ahead of a system poppler, so a
# Windows contributor and CI silently run different checks on the same commit.
#
# -v is the discriminator. Poppler prints "The Poppler Developers"; Xpdf prints
# "[www.xpdfreader.com]". Both are checked because a PATH can resolve them to
# different projects.
#
# PRESS_PDFTOTEXT and PRESS_PDFFONTS exist because on Windows PATH is not the
# user's to order. Git for Windows' sh prepends its own /mingw64/bin and /usr/bin at
# startup, so the Xpdf pdftotext it bundles wins inside every tool, no matter what
# PowerShell or a .bashrc resolves: winget puts poppler's Library/bin on the user PATH,
# and outside sh, where mingw64/bin is not on PATH at all, poppler's is the one found. A
# Windows contributor has no reachable lever. Naming the executable directly is that
# lever, and it is press-scoped: nothing else on the machine reads these names, so unlike
# renaming the bundled binary it shifts no other tool's dependency. (Measured on Git
# 2.55, which bundles no pdffonts or pdftoppm.)
#
# The assertion is unchanged either way. Being pointable does not mean being
# trusted; whatever it is aimed at still has to say poppler.
PDFTOTEXT=${PRESS_PDFTOTEXT:-pdftotext}
PDFFONTS=${PRESS_PDFFONTS:-pdffonts}
for spec in "PRESS_PDFTOTEXT $PDFTOTEXT" "PRESS_PDFFONTS $PDFFONTS"; do
    var=${spec%% *}; tool=${spec#* }
    command -v "$tool" >/dev/null 2>&1 \
        || { [ -z "$optional" ] || skip "poppler's $tool is not found"
             echo "press: check needs poppler; $tool not found" >&2
             echo "       set $var to poppler's binary if it is not on PATH" >&2
             exit 1; }
    "$tool" -v 2>&1 | grep -qi poppler \
        || { [ -z "$optional" ] || skip "$tool is not poppler's"
             echo "press: $tool is not poppler's —" >&2
             "$tool" -v 2>&1 | head -1 | sed 's/^/  /' >&2
             echo "       extractors disagree about which glyphs a PDF contains, so the" >&2
             echo "       glyph check is only meaningful against poppler." >&2
             echo "       Put it first on PATH, or set $var to it directly. On Windows, Git's sh puts" >&2
             echo "       its own /mingw64/bin, with Xpdf's pdftotext, ahead of PATH: set $var there." >&2
             exit 1; }
done

# ACCEPTED FINDINGS. A document may accept a finding it keeps on purpose, a sent record that
# will not be restyled, with a line in its own source naming the pass and why:
#
#   // press: accept ink-margin — sent 2026-03-02, kept as sent
#
# That pass's findings still print, then a line saying they were accepted and why, and they do
# not fail. A reason is required, and the pass must be one of $passes. An acceptance its pass
# finds nothing for fails: left standing, it would hide that pass's next real finding.
#
# Only the document's own file accepts. An acceptance in a file it imports or includes, a
# shared template, would speak for every document that uses the file; a finding that file
# causes is the file's to fix, so such a line is refused.
passes="warnings fonts glyphs ink-margin text-on-text"
accepted=
hit=
skipped=
: > "$tmp/reasons"
accept_re='^[[:space:]]*//[[:space:]]*press:[[:space:]]*accept([[:space:]]|$)'
grep -E "$accept_re" "$src" > "$tmp/accepts" || true
while IFS= read -r f; do
    if grep -qE "$accept_re" "$f" && ! cmp -s "$f" "$src"; then
        echo "press: $f accepts a finding, but only the document's own file may ($src):" >&2
        echo "       a finding a shared file causes is that file's to fix" >&2
        rc=1
    fi
done < "$tmp/sources"
while IFS= read -r line; do
    rest=$(printf '%s\n' "$line" | sed -E 's#^[[:space:]]*//[[:space:]]*press:[[:space:]]*accept[[:space:]]*##')
    name=$(printf '%s\n' "$rest" | awk '{ print $1 }' | sed 's/:$//')
    reason=$(printf '%s\n' "$rest" | sed -E 's/^[^[:space:]]*[[:space:]]*//; s/^(—|-|:)[[:space:]]*//')
    case " $passes " in
        *" $name "*) ;;
        *) echo "press: $src accepts \"$name\", which is not a pass; the passes are: $passes" >&2
           rc=1; continue ;;
    esac
    if [ -z "$reason" ]; then
        echo "press: $src accepts $name with no reason; say why: // press: accept $name — <why>" >&2
        rc=1; continue
    fi
    accepted="$accepted $name"
    printf '%s\t%s\n' "$name" "$reason" >> "$tmp/reasons"
done < "$tmp/accepts"
# found <pass>: the pass found something; it fails the audit unless the document accepts it.
found() {
    hit="$hit $1"
    case " $accepted " in *" $1 "*) ;; *) rc=1 ;; esac
}

# SCANS (lib.typ's scan()). A document that reads an image file may have marked some of it as a
# scan, content it did not set. The passes that read the page — fonts, ink near the edge, text
# on text — then read a copy compiled with every scan hidden, its space kept and its stamp the
# same, so the page lays out exactly as the document's does, without the scans. A document
# that reads no image is read as it is, with no second compile.
page=$pdf
if tr '\000' '\n' < "$tmp/deps" | grep -qiE '\.(pdf|png|jpe?g|gif|svg|webp)$'; then
    if PRESS_IN_CHECK=1 PRESS_STAMP_AS="$pdf" sh "$press_root/tools/stamp.sh" "$src" "$tmp/scans-hidden.pdf" \
            "$@" --input press-scans=hidden 2>/dev/null; then
        page=$tmp/scans-hidden.pdf
    fi
fi
# The PRINTABLE-AREA check. A document can overflow the unprintable band
# silently: typst has no concept of it, so the failure appears on paper and
# nowhere else. Skipped rather than fatal where no interpreter is present,
# because font checking is worth having on its own and press must stay usable on
# a box that has poppler but no python at all.
#
# `command -v python3` was the guard and it FAILED BOTH WAYS on Windows.
#
#   Present but not real: the stock Windows App Execution Alias puts a zero-byte
#   python3 on PATH that prints "Python was not found" and exits 49. command -v
#   said yes, the printable-area check ran, and check exited 1 having printed
#   nothing but a Microsoft Store advert.
#
#   Real but not named python3: disabling that alias — which uv's own setup
#   recommends — leaves a working `python` and no `python3` at all, so the check
#   silently skipped forever. Measured on a host where it hid a genuine 0.32in
#   clipping fault in a document whose entire purpose was to be printed.
#
# So probe by EXECUTING a candidate rather than by resolving its name, and accept
# `python`, which is what a Windows install is actually called. An interpreter
# that cannot run `pass` is not an interpreter, whatever PATH says about it.
# PRESS_PYTHON is tested SEPARATELY and quoted, never as a word in the candidate
# list. Unquoted it word-splits, and the likeliest Windows value is exactly the
# case that breaks: C:\Program Files\Python312\python.exe becomes "C:\Program" and
# "Files\Python312\python.exe", neither of which runs.
#
# An override that is set but cannot run says so rather than falling through in
# silence -- that is a typo the operator wants to hear about -- but it still falls
# back, because this pass is skippable and a bad override should not take out the
# font checks with it.
PY=
if [ -n "${PRESS_PYTHON:-}" ]; then
    if "$PRESS_PYTHON" -c 'pass' >/dev/null 2>&1; then
        PY=$PRESS_PYTHON
    else
        echo "press: PRESS_PYTHON is set but will not run: $PRESS_PYTHON" >&2
        echo "       falling back to python3 / python" >&2
    fi
fi
if [ -z "$PY" ]; then
    for cand in python3 python; do
        if "$cand" -c 'pass' >/dev/null 2>&1; then PY=$cand; break; fi
    done
fi
if [ -n "$PY" ] && [ -n "$optional" ] && ! command -v "${PRESS_PDFTOPPM:-pdftoppm}" >/dev/null 2>&1; then
    # A build without pdftoppm skips this pass and says so; check reports it as the pass fails.
    echo "press: skipping the printable-area check (no pdftoppm, which comes with poppler)" >&2
    skipped="$skipped ink-margin"
elif [ -n "$PY" ]; then
    # 1 is a finding; anything else is the pass failing to run, which no acceptance covers.
    s=0
    PRESS_PDFTOPPM="${PRESS_PDFTOPPM:-pdftoppm}" \
        "$PY" "$press_root/tools/ink-margin.py" "$page" 0.48 "$pdf" || s=$?
    case $s in 0) ;; 1) found ink-margin ;; *) rc=1; skipped="$skipped ink-margin" ;; esac
else
    echo "press: skipping the printable-area check (no working python found)" >&2
    skipped="$skipped ink-margin"
    echo "       set PRESS_PYTHON to one if it is not on PATH as python3 or python" >&2
fi
# The OVERLAP check — text printed on top of text. A document can collide with
# itself, clear every other check, and reach paper: typst emits no warning
# because nothing is wrong, the document is valid and simply renders on top of
# itself. It was found in practice by people looking at rendered pages,
# repeatedly, which is what this removes.
#
# Shares the printable-area check's interpreter and skip behaviour, and the same
# reasoning: a box with poppler and no python still gets the font checks. It does
# NOT share its instrument — see the module docstring for why the raster cannot
# answer this and pdftotext can.
if [ -n "$PY" ] && [ -n "$optional" ] && ! "$PY" -c 'import xml.parsers.expat' >/dev/null 2>&1; then
    # A build whose python has no XML parser skips this pass and says so, as for pdftoppm above;
    # check runs it, and the pass reports that it could not.
    echo "press: skipping the line-overlap check ($PY has no XML parser)" >&2
    skipped="$skipped text-on-text"
elif [ -n "$PY" ]; then
    s=0
    PRESS_PDFTOTEXT="$PDFTOTEXT" "$PY" "$press_root/tools/line-overlap.py" "$page" "$pdf" || s=$?
    case $s in 0) ;; 1) found text-on-text ;; *) rc=1; skipped="$skipped text-on-text" ;; esac
else
    echo "press: skipping the line-overlap check (no working python found)" >&2
    skipped="$skipped text-on-text"
fi
warns=$(printf '%s\n' "$out" | grep '^warning:' || true)
if [ -n "$warns" ] && [ -n "${PRESS_BUILT_DEPS:-}" ]; then
    # The build printed them already, just above.
    echo "press: $src compiles with the warnings above — typst exits 0 on these and there is" >&2
    echo "       no deny-warnings flag, so they ship unless something reads them" >&2
    found warnings
elif [ -n "$warns" ]; then
    echo "press: $src compiles with warnings — typst exits 0 on these and there is no" >&2
    echo "       deny-warnings flag, so they ship unless something reads them:" >&2
    echo "$warns" | sed 's/^/  /' >&2
    found warnings
fi
# A face is vendored when its name, past the subset prefix, is a vendored family alone or
# followed by -: OpenSans, OpenSans-Bold, Montserrat-Bold-Identity-H. Without the - a family
# that only begins with a vendored one, like LiberationSansNarrow, would pass as it.
leaks=$("$PDFFONTS" "$page" | tail -n +3 | awk '{print $1}' | sed 's/^[A-Z]*+//' | grep -vE "^($allow)(-|\$)" || true)
if [ -n "$leaks" ]; then
    echo "press: $pdf draws from fonts that are NOT vendored here —" >&2
    echo "$leaks" | sort -u | sed 's/^/  /' >&2
    found fonts
fi
# (*UTF) forces PCRE to match characters rather than bytes. Without it the class
# is byte-oriented under a non-UTF-8 locale, so every multi-byte character is split
# into its bytes and each byte is probed as though it were a character — none of
# which render, so a clean document reports one false missing glyph per byte.
#
# The verb rather than LC_ALL=C.UTF-8 on purpose: the locale must exist to take
# effect, macOS has no C.UTF-8, and glibc falls back to C *silently* when a locale
# is missing. That reintroduces the bug while the check reports success, which is
# the one failure mode this check exists to prevent. The verb needs nothing from
# the environment; the guard above is what makes its absence loud.
#
# `|| true` stays: grep exits 1 on a document with no non-ASCII characters at all,
# which is a clean result, not an error. Exit 2 is what would matter here, and the
# guard has already ruled out the only way to provoke it.
#
# \p{Z} and \p{Cf} are dropped because only a character that HAS a glyph can be
# missing one. Space separators and format characters are absence by design, and
# pdftotext gives back a plain space for U+00A0, so probing them fails a document
# that is correct. Stray invisible characters in source are a real concern and a
# different one; the check that owns that concern should own it. The characters come from
# the document's own sources, listed above.
#
# Comments never reach the page, so their characters are not probed: a // comment that starts
# a line or follows a space, and a /* */ comment over any number of lines. A // inside a URL
# (https://) follows no space and stays. Text in a raw block that holds " //" loses what
# follows, a rare miss taken over the false findings a comment's characters gave. A string
# the document never places is still read; a document that keeps one accepts glyphs.
uncommented() {
    awk '{
        s = $0; out = ""
        while (length(s) > 0) {
            if (inblock) {
                e = index(s, "*/")
                if (!e) { s = ""; break }
                s = substr(s, e + 2); inblock = 0
                continue
            }
            b = index(s, "/*"); lc = 0
            if (substr(s, 1, 2) == "//") lc = 1
            else if (match(s, /[ \t]\/\//)) lc = RSTART + 1
            if (lc && (!b || lc < b)) { out = out substr(s, 1, lc - 1); break }
            if (b) { out = out substr(s, 1, b - 1); s = substr(s, b + 2); inblock = 1; continue }
            out = out s; s = ""
        }
        print out
    }' "$1"
}
chars=$(while IFS= read -r f; do uncommented "$f"; done < "$tmp/sources" \
        | "$GREP" -oP '(*UTF)[^\x00-\x7F]' \
        | grep -vP '(*UTF)^[\p{Z}\p{Cf}]$' \
        | sort -u || true)
if [ -n "$chars" ]; then
    fontdir="$press_root/fonts"
    typst fonts --ignore-system-fonts | sort > "$tmp/embedded"
    typst fonts --font-path "$fontdir" --ignore-system-fonts | sort > "$tmp/all"
    fams=$(comm -13 "$tmp/embedded" "$tmp/all" | sed 's/.*/"&"/' | paste -sd, -)
    for ch in $chars; do
        printf '#set page(width: 6cm, height: 2cm)\n#set text(font: (%s))\nX%sX\n' "$fams" "$ch" > "$tmp/probe.typ"
        typst compile --root "$tmp" --font-path "$fontdir" --ignore-system-fonts "$tmp/probe.typ" "$tmp/probe.pdf" 2>/dev/null || true
        if ! "$PDFTOTEXT" "$tmp/probe.pdf" - 2>/dev/null | grep -qF "$ch"; then
            echo "press: $pdf is MISSING a character present in the source: $ch" >&2
            found glyphs
        fi
    done
fi
# A build's stdout is its one status line, so only check says clean.
for p in $accepted; do
    r=$(awk -F '\t' -v p="$p" '$1 == p { print $2; exit }' "$tmp/reasons")
    case " $hit " in
        *" $p "*) echo "press: $pdf: the $p findings above are accepted — $r" >&2 ;;
        *) case " $skipped " in
               *" $p "*) ;;
               *) echo "press: $src accepts $p, but there is no $p finding; remove the line, or it" >&2
                  echo "       hides the next one" >&2
                  rc=1 ;;
           esac ;;
    esac
done
if [ "$rc" -eq 0 ] && [ -z "$optional" ]; then
    if [ -z "$hit" ]; then echo "press: $pdf clean"; else echo "press: $pdf passes, with its accepted findings"; fi
fi
# For stamp.sh's build record: the audit ran every pass and passed. A build whose audit skipped
# anything is not recorded, so the next build audits again once the tools are there.
if [ "$rc" -eq 0 ] && [ -z "$skipped" ] && [ -n "${PRESS_AUDIT_RAN:-}" ]; then : > "$PRESS_AUDIT_RAN"; fi
exit "$rc"
