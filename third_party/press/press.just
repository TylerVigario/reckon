# press — build recipes for Typst documents, read on screen or on paper.
#
# ONE WAY IN, for a repo that already builds with just. Underneath, each recipe is one call to a
# tool under tools/ — build, all, watch, new, clean — which any runner calls the same way: an npm
# script, a Makefile, CI. A repo never adopts just for press.
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
# WHAT `build` DOES that a bare `typst compile` will not, in tools/build.sh and the tools it calls:
#   · derives the output path, so print/ mirrors the source tree by rule
#     rather than by every author remembering the convention;
#   · creates that directory — typst refuses to write into one that does not
#     exist and fails with a bare "No such file or directory";
#   · carries --root, --font-path and --ignore-system-fonts;
#   · stamps the document with when its content last changed (tools/stamp.sh);
#   · audits what it built, and fails on a finding (tools/check.sh, through stamp.sh).

# The oldest just this file works with. A just that knows the setting refuses this file with
# "requires just 1.55.0 or later"; one older still stops at this line with "unknown setting",
# and the line it shows names the version. typst's floor is press.toml's, which lib/tokens.typ and
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
# import, invoked from the root and from a subdirectory. Paths are root-relative, exactly as in
# any ordinary justfile, and the tools each recipe calls run there too.
root := justfile_directory()

# The recipes are scripts ([script]), run by just's default script interpreter, sh -eu: a
# failing command ends the recipe, as the && chains they replaced did.
#
# Each tool a recipe calls writes a document's path with forward slashes first, as src, and
# drops a leading ./. Given .\docs\x.typ, which is what PowerShell's tab completion
# produces, the PDF would otherwise be print/.\docs\x.pdf: two separators in one path.
# Typst takes / on Windows too, and a backslash is never sensibly part of a document's
# name. The PDF is then print/${src%.typ}.pdf, made in the shell from src.
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
# tools/build.sh does the work, as it does for any runner: stamp.sh stamps the page with when
# its content last changed and audits it, and report.sh says in one line what was made. A
# finding prints above that line and fails the recipe.
[doc("Compile and audit one document -> print/<same path>.pdf")]
[script]
[working-directory(root)]
[arg('doc', pattern='.+\.typ', help='a .typ file, relative to the repo root')]
build doc:
    sh {{ quote(press_root / "tools" / "build.sh") }} {{ quote(doc) }}

# Recompile one document on every save -> print/<same path>.watch.pdf
#
# tools/watch.sh does the work: a preview beside the PDF build makes, not over it, so the next
# build does not re-stamp a page that never changed. Why is at the top of that file.
[doc("Recompile one document on every save -> print/<same path>.watch.pdf")]
[script]
[working-directory(root)]
[arg('doc', pattern='.+\.typ', help='a .typ file, relative to the repo root')]
watch doc:
    sh {{ quote(press_root / "tools" / "watch.sh") }} {{ quote(doc) }}

# Compile every document under the given directories (default docs/)
#
#   just all                              -> docs/
#   just all recipes protocols concerns   -> a repo whose taxonomy IS the point
#
# tools/all.sh does the work, as it does for any runner: it finds the documents, not the files
# they are made of and not press's own, builds every one, ends with the count, and fails if any
# failed. Why it builds what it builds is at the top of that file.
#
# The directories reach the shell as its own arguments, "$@", not as {{ dirs }}: that is
# one string of every name joined by spaces, so a name with a space in it would split.
[doc("Compile and audit every document under the given directories (default docs/), not its parts")]
[script]
[working-directory(root)]
[positional-arguments]
[arg('dirs', help='directories to search for .typ files, relative to the repo root')]
all +dirs='docs':
    sh {{ quote(press_root / "tools" / "all.sh") }} "$@"

# Scaffold a new document from a press starter, main, letter, recipe or resume -> <name>/main.typ
#
# tools/new.sh does the work, as it does for any runner: it copies the template and writes
# its import as press's path from the root. This adds only the next steps, as just was
# invoked (module_path() is empty under import, the module's name under mod).
[doc("Scaffold a new document from a press starter: main, letter, recipe or resume")]
[script]
[working-directory(root)]
[arg('name', help='the directory to create, holding main.typ; no .typ of its own')]
[arg('template', help='the starter to copy: main, letter, recipe or resume')]
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
# tools/build.sh --check does the work, as it does for any runner: tools/check.sh, which runs
# every pass and refuses without the audit's tools. What each pass catches, how, and where it
# stops is at the top of that file.
[doc("Audit a built PDF for what typst lets through: warnings, fonts, glyphs, edges, overlaps")]
[script]
[working-directory(root)]
[arg('doc', pattern='.+\.typ', help='a .typ file, relative to the repo root')]
check doc:
    sh {{ quote(press_root / "tools" / "build.sh") }} --check {{ quote(doc) }}

# Delete rendered output
#
# Anchored like the rest: without it, running this from a subdirectory deleted a
# stray print/ there and left the real one intact, reporting success either way.
[doc("Delete rendered output")]
[script]
[working-directory(root)]
clean:
    sh {{ quote(press_root / "tools" / "clean.sh") }}
