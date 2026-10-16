# press — build recipes for Typst documents, read on screen or on paper.
#
# ONE WAY IN, for a repo that already builds with just. Underneath it is plain typst with
# press's fonts, plus the files under tools/ — stamp, check, report, new — which any runner
# calls the same way: an npm script, a Makefile, CI. A repo never adopts just for press.
#
# A consuming repo that does use just carries a one-line justfile. If it has no recipes of its
# own:
#
#   import 'third_party/press/press.just'     ->  just build docs/x.typ
#
# If it already has its own — and `build`, `all` and `clean` are names most
# repos will already be using — import HARD-ERRORS on the duplicate. Use a
# module instead, which namespaces them:
#
#   mod press 'third_party/press/press.just'  ->  just press build docs/x.typ
#
# Every recipe runs in the consumer's root, [working-directory(root)], so both forms
# behave identically: a module would otherwise run with press's own directory as the
# working directory, and every document path would resolve against the wrong tree.
#
# WHY sh EVERYWHERE, with no [windows] attributes: it is `just`'s own default
# and primary path — "just uses `sh` on Windows by default", with PowerShell
# offered only for people who would rather not install `sh`. The maintainer's
# direction for cross-platform recipes (casey/just#531) is to select on shell
# *availability* rather than on OS, which makes OS attributes the workaround
# rather than the destination. On Windows `sh` comes from Git for Windows,
# which is already a prerequisite for cloning this repo at all.
#
# WHAT THIS DOES that a bare `typst compile` will not:
#   · derives the output path, so print/ mirrors the source tree by rule
#     rather than by every author remembering the convention;
#   · creates that directory — typst refuses to write into one that does not
#     exist and fails with a bare "No such file or directory";
#   · carries --root, --font-path and --ignore-system-fonts;
#   · stamps the document with when its content last changed (tools/stamp.sh);
#   · audits what it built, and fails on a finding (tools/check.sh, through stamp.sh).

# The oldest just this file works with. A just that knows the setting refuses this file with
# "requires just 1.55.0 or later"; one older still stops at this line with "unknown setting",
# and the line it shows names the version. typst's floor is press.toml's, which lib.typ and
# tools/stamp.sh enforce for every runner. CI builds and checks at both floors, installed by
# the toolchain action's OLDEST_ pins, so raising one is an edit there too.
set minimum-version := '1.55.0'

# Where press itself lives, resolved from THIS file rather than the consumer's
# root justfile — so press may be vendored at any path and nothing here
# hardcodes one. justfile_directory() would resolve to the importing repo's
# root, which is exactly wrong under `import`.
press_root := source_directory()

# The CONSUMER's root — where print/ belongs and where document paths are
# resolved from. Every recipe runs here: [working-directory(root)].
#
# Under `mod`, a recipe would otherwise run in press's own directory. Running from
# wherever just was invoked instead, [no-cd], is a silent-wrong-output bug:
# `just press build one.typ` from inside recipes/ exits 0, prints print/one.pdf, and
# writes recipes/print/one.pdf — a second output tree nested in the source. `clean`
# then deletes THAT one and reports nothing while the real print/ survives untouched.
#
# So every recipe names its directory, and it is this one, in all four cases — mod and
# import, invoked from the root and from a subdirectory — and under `all`'s --set root.
# Paths are root-relative, exactly as in any ordinary justfile.
root := justfile_directory()

# --ignore-system-fonts removes the MACHINE's fonts, so output cannot vary by
# machine. It does not isolate the vendored faces: typst's own embedded fonts
# stay reachable as per-glyph fallbacks. See FONTS.md.
typst_flags := "--root . --font-path " + quote(press_root / "fonts") + " --ignore-system-fonts"

# The recipes are scripts ([script]), run by just's default script interpreter, sh -eu: a
# failing command ends the recipe, as the && chains they replaced did.
#
# Every recipe that takes a document path writes it with forward slashes first, as src, and
# drops a leading ./. Given .\docs\x.typ, which is what PowerShell's tab completion
# produces, the PDF would otherwise be print/.\docs\x.pdf: two separators in one path.
# Typst takes / on Windows too, and a backslash is never sensibly part of a document's
# name. The PDF is then print/${src%.typ}.pdf, made in the shell from src, so no path
# function of just's can rejoin it with a backslash.
#
# build, watch and check take only a path ending in .typ, and new only a name that does
# not end in one. A directory, a PDF or a markdown file is refused by name before typst
# sees it, rather than failing inside it.

# The recipe list, as the first recipe. Under `mod press`, `just press` runs a module's first
# recipe, so it lists press's. Under `import` the default comes from the consumer's own
# justfile, never an imported one, so a one-line justfile lists with `just --list`. Named
# _list, not default: a consumer with its own `default` recipe and an import would otherwise
# fail with "recipe `default` first defined ... is redefined". Not [default] either: that
# would claim the consumer's default, and clash with a consumer's own [default].
[private]
_list:
    @{{ quote(just_executable()) }} --list --unsorted

# Compile one document and audit it → print/<same path>.pdf
#
# The path is relative to the repo root, from whichever directory you invoke it.
#
# Through tools/stamp.sh, which stamps the document with when its content last changed
# (sys.inputs.press-updated, shown by lib.typ's updated()) and keeps that time when a
# rebuild changes nothing on the page. The reasoning is at the top of that file.
#
# Then tools/report.sh says what was made, in one line: new, changed or unchanged, pages,
# words (where poppler is installed), size, and the stamp the page carries. stamp.sh audits
# what it built; a finding prints above that line and fails the recipe.
[doc("Compile and audit one document -> print/<same path>.pdf")]
[script]
[working-directory(root)]
[arg('doc', pattern='.+\.typ', help='a .typ file, relative to the repo root')]
build doc:
    src={{ quote(trim_start_match(replace(doc, '\', '/'), './')) }}
    pdf="print/${src%.typ}.pdf"
    # A finding fails the build after the PDF is written, so the line still says what was
    # made; a compile that failed made nothing to report.
    rc=0
    st=$(sh {{ quote(press_root / "tools" / "stamp.sh") }} "$src" "$pdf" {{ typst_flags }}) || rc=$?
    [ -n "$st" ] || exit "$rc"
    sh {{ quote(press_root / "tools" / "report.sh") }} "$pdf" $st
    if [ "$rc" -ne 0 ] && [ -n "${PRESS_TALLY:-}" ]; then echo audit >> "$PRESS_TALLY"; fi
    exit "$rc"

# Recompile one document on every save -> print/<same path>.watch.pdf
#
# A preview, beside the PDF build makes rather than over it. typst watch passes no stamp, so
# writing over print/<doc>.pdf would leave a PDF whose date stamp.sh cannot read, and the next
# build would re-stamp a page that never changed, saying "reprint" about it. The preview's
# footer says it is not stamped; build makes the copy to print.
[doc("Recompile one document on every save -> print/<same path>.watch.pdf")]
[script]
[working-directory(root)]
[arg('doc', pattern='.+\.typ', help='a .typ file, relative to the repo root')]
watch doc:
    src={{ quote(trim_start_match(replace(doc, '\', '/'), './')) }}
    pdf="print/${src%.typ}.watch.pdf"
    mkdir -p "$(dirname "$pdf")"
    typst watch {{ typst_flags }} "$src" "$pdf"

# Compile every document under the given directories (default docs/)
#
#   just all                              -> docs/
#   just all recipes protocols concerns   -> a repo whose taxonomy IS the point
#
# The default is a convenience, not a required layout. press claims to be
# additive rather than governing, and a build recipe that only walks docs/ would
# quietly make that false — a repo organised by meaning rather than by kind
# should not have to restructure, or write its own `all`, to use this.
#
# DOCUMENTS, NOT THE FILES THEY ARE MADE OF. A document can #include chapters or #import
# a file of its own definitions, and those compiled on their own fail or print a stray
# page. So two kinds of .typ file are parts, not documents, and are not built:
#
#   · one whose name starts with _ — docs/_shared.typ, imported by several documents;
#   · any file in a directory that holds a main.typ, other than that main.typ, at any
#     depth below it — the shape `just new` makes, docs/book/main.typ beside its chapters.
#
# A directory named on the command line is a place to look, not a document, so a main.typ
# directly inside one (docs/main.typ) makes nothing else in it a part.
#
# Fails loudly on an empty result rather than reporting a green build that
# produced nothing — the state a repo is in before it has adopted any layout,
# and the one where a false success is most expensive. The xargs form (rather
# than a `while read` loop) is what makes a single failing document fail the
# whole recipe: a loop's exit status is only its last iteration's, so doc 1
# could fail and doc 9 succeed and `all` would still exit 0.
#
# It runs the `just` that is running it (just_executable()), not whichever one PATH finds
# first: another just ahead on PATH would otherwise build every document.
#
# It reaches `build` through --justfile rather than as a bare `just build`,
# because under `mod press` the recipe is `press build` and a bare call does not
# resolve — it looks in the CONSUMER's justfile and fails with "does not contain
# recipe `build`". Naming this file explicitly makes `all` behave the same under
# both consumption forms, which is the whole point of running every recipe in root.
#
# --set root is not optional. Under --justfile THIS file becomes the justfile,
# so justfile_directory() would resolve to press's own directory and every
# document path would be looked up there. Passing the consumer root down keeps
# the anchor correct through the recursion.
#
# It ends with a count of what the run did (changed, new, unchanged, failed). Each document
# is built in its own `just`, so report.sh appends each status to a file named by
# PRESS_TALLY, and the count is read from that once xargs is done. The exit status is still
# xargs's.
#
# The directories reach the shell as its own arguments, "$@", not as {{ dirs }}: that is
# one string of every name joined by spaces, so a name with a space in it would split.
[doc("Compile and audit every document under the given directories (default docs/), not its parts")]
[script]
[working-directory(root)]
[positional-arguments]
[arg('dirs', help='directories to search for .typ files, relative to the repo root')]
all +dirs='docs':
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
    find "$@" -name '*.typ' -type f | LC_ALL=C sort | ROOTS=$roots awk '
        BEGIN { n = split(ENVIRON["ROOTS"], r, "\n"); for (i = 1; i <= n; i++) root[r[i]] = 1 }
        { f[++k] = $0
          if ($0 ~ /\/main\.typ$/) { d = $0; sub(/\/main\.typ$/, "", d); if (!(d in root)) proj[d] = 1 } }
        END {
            for (i = 1; i <= k; i++) {
                base = f[i]; sub(/.*\//, "", base)
                if (base ~ /^_/) continue
                part = 0
                for (p in proj) if (index(f[i], p "/") == 1 && f[i] != p "/main.typ") { part = 1; break }
                if (!part) print f[i]
            }
        }' > "$docs"
    n=$(wc -l < "$docs" | tr -d ' ')
    test "$n" -gt 0 || { echo "press: no documents in: $*" >&2; exit 1; }
    rc=0
    tr '\n' '\000' < "$docs" \
        | xargs -0 -n1 {{ quote(just_executable()) }} --justfile {{ quote(press_root / "press.just") }} --set root {{ quote(root) }} build \
        || rc=$?
    sh {{ quote(press_root / "tools" / "report.sh") }} --summary "$PRESS_TALLY" "$n"
    exit "$rc"

# Scaffold a new document from a press starter, main or letter -> <name>/main.typ
#
# tools/new.sh does the work, as it does for any runner: it copies the template and writes
# its import as press's path from the root. This adds only the next steps, as just was
# invoked (module_path() is empty under import, the module's name under mod).
[doc("Scaffold a new document from a press starter: main, or letter")]
[script]
[working-directory(root)]
[arg('name', help='the directory to create, holding main.typ; no .typ of its own')]
[arg('template', help='the starter to copy: main, or letter')]
new name template='main':
    sh {{ quote(press_root / "tools" / "new.sh") }} {{ quote(name) }} {{ quote(template) }}
    n={{ quote(trim_end_match(replace(name, '\', '/'), '/')) }}
    j={{ quote(if module_path() == "" { "just" } else { "just " + replace(module_path(), "::", " ") }) }}
    f="$n/main.typ"
    case $f in *[[:space:]]*) f="'$f'" ;; esac
    echo "       build it with: $j build $f"
    echo "       preview it with: $j watch $f"

# Audit a built document for what typst lets through without a word
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
# The WARNINGS check reads typst's own output. `build` exits 0 on warnings and
# typst has no
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
#     that disagree about which glyphs a PDF contains, so the recipe asserts the
#     implementation rather than the name. pdftoppm carries no such assertion:
#     Git for Windows bundles no pdftoppm at all, so on Windows it is an absence
#     problem. Xpdf ships one too, and press has not been run against it.
#     That is also why this is a separate recipe rather than part of build:
#     building must not require any of it.
#     Set PRESS_PDFTOTEXT / PRESS_PDFFONTS to point at them directly where PATH
#     cannot be made to resolve poppler first — on Windows it cannot, because
#     Git's sh prepends its own bin directories at startup and the Xpdf copies
#     bundled there win inside every recipe. The assertion still applies to
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
#
# The passes themselves live in tools/check.sh, which any runner calls directly, and
# which is how it should be exercised when changing it. It compiles through
# tools/stamp.sh, as build does, so a document that was never built is built first.
[doc("Audit a built PDF for what typst lets through: warnings, fonts, glyphs, edges, overlaps")]
[script]
[working-directory(root)]
[arg('doc', pattern='.+\.typ', help='a .typ file, relative to the repo root')]
check doc:
    src={{ quote(trim_start_match(replace(doc, '\', '/'), './')) }}
    pdf="print/${src%.typ}.pdf"
    sh {{ quote(press_root / "tools" / "check.sh") }} "$src" "$pdf" {{ quote(press_root) }} {{ typst_flags }}

# Delete rendered output
#
# Anchored like the rest: without it, running this from a subdirectory deleted a
# stray print/ there and left the real one intact, reporting success either way.
[doc("Delete rendered output")]
[script]
[working-directory(root)]
clean:
    rm -rf print
