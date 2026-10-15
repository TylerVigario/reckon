# press

A scaffolding kit for Typst documents: page presets, a type and colour system, ready-made
parts, a template, and tools that stamp and audit what you build. It serves anything from a
one-page information sheet to a conversation piece, a manual or a book, and one PDF serves both
the screen and the printer. Anyone can use it, under the AGPL (see [Licence](#licence)).

This README ships in every release. Working on press itself? Its repository's
[`CLAUDE.md`](https://github.com/TylerVigario/press/blob/main/CLAUDE.md) covers that.

## Why this exists

**Every document should start from decisions already made well**, so its author spends the
effort on what it says. The page, the type, the colours and the parts a reader learns to
recognise are decided once, not again in every document.

Typst makes a good document easy to write and hard to keep consistent. Left alone, each one
re-decides its page, its type scale and how a warning looks, and the copies of those decisions
drift apart. press holds them in one kit every repository making documents can take, so a new
document starts from a ready-made template and ready-made parts, and a fix made for one
document reaches all of them at the next release. It offers rather than governs: its
templates are a universal default, imported as they are or copied and changed, as a
repository wishes.

It is more than styling. Its stamp marks each document with when its content last changed, so
a printed copy can be checked against the current one, and its audit catches the font and
glyph failures typst lets through without a word. A document is built the same way on every
machine, from fonts that ship with press.

**One output, read anywhere.** A press document is a single PDF that reads on a screen and
prints true, so every part is made for both:

- **Text is real text:** searchable, copyable, and set in vendored fonts, so it renders the
  same on every machine.
- **Links work on both:** they click on screen, and `link-note` footnotes their address for
  paper.
- **A document names itself once:** its title is the PDF's metadata, so a viewer shows it,
  and the template prints it in the header and footer from there.
- **Colour is never the only carrier of meaning,** so a greyscale printer or a colour-blind
  reader loses nothing.
- **Commands are short and unwrapped,** so they copy cleanly from the screen and can be typed
  from paper.
- **Pages keep all ink 0.5in from the edge,** so printing at actual size never clips; on
  screen it is simply margin.
- **Self-contained.** If a fact is needed to act, it is in the document. A runbook kept beside
  the machine it describes is read exactly when that machine is down.

**From a sheet to a book.** The same tokens and parts carry a one-page reference card, a
proposal, a manual and a book. Short documents are best served today. press grows from the
documents that use it: a template or part is added when a real document needs it, and from
the next release every document can use it.

## Install

press is a folder of files your repository holds. From the directory it should live in —
`third_party/` at the project root, as this guide assumes — run the installer for your
system. It puts `press/` there, and run again it updates it:

| system | line |
|---|---|
| Linux, macOS | `curl -fsSL https://github.com/TylerVigario/press/releases/latest/download/install.sh \| sh` |
| Linux without curl | `wget -qO- https://github.com/TylerVigario/press/releases/latest/download/install.sh \| sh` |
| Windows, from PowerShell or `cmd.exe` | `powershell -NoProfile -c "irm https://github.com/TylerVigario/press/releases/latest/download/install.ps1 \| iex"` |

Each release attaches its own installer, which installs that release: `latest/download` is the
newest, and `download/v<version>` in its place fixes one. The installer downloads its
release's archive, refuses it unless its SHA-256 is the one written into the installer, and
swaps the new `press/` in whole, so a file a release removed does not linger. A `press/` that
is not press, or is a git checkout, it leaves alone, and it changes nothing outside `press/`.

**Any directory under the project root works**: typst reads no file outside it, and `new.sh`
writes each import for wherever press sits. Not `vendor/`, which other toolchains own:
`go mod vendor` deletes whatever else is in it, its presence alone breaks `go build` in a Go
module with dependencies it does not vendor, and Composer projects keep it out of git.

**Commit `press/`.** The copy your repository holds is the version it builds with, and
`press/press.toml` says which. Run the installer again to move to the newest release: the diff
shows what changed.

**Without the installer,** the archives unpack with the same tools. Delete `press/` first when
updating, or files a release removed stay behind:

| system | line |
|---|---|
| Linux, macOS | `curl -fsSL https://github.com/TylerVigario/press/releases/latest/download/press.tar.gz \| tar -xz` |
| Windows, PowerShell 5.1 or 7 | `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest https://github.com/TylerVigario/press/releases/latest/download/press.zip -OutFile press.zip; Expand-Archive press.zip -DestinationPath .; Remove-Item press.zip` |

Under the Restricted execution policy, PowerShell 7 cannot load `Expand-Archive`; the
installer does not use it. Each release's `SHA256SUMS` lists both archives and both
installers. **Never stream the zip into `tar`.** A zip is read from its end: piped into `tar`,
files are dropped silently and it still exits 0. Pipe the tarball; unpack the zip from a file.

## Use it

A document imports press by its path from the project root:

```typst
#import "/third_party/press/lib.typ": *
```

and builds with plain typst, from whatever runs your builds:

```sh
typst compile --root . --font-path third_party/press/fonts --ignore-system-fonts docs/guide.typ print/guide.pdf
```

The same three settings can come from the environment instead — `TYPST_ROOT=.`,
`TYPST_FONT_PATHS=third_party/press/fonts`, `TYPST_IGNORE_SYSTEM_FONTS=true` — which also serves
`typst watch` and an editor. press must sit under the project root, since typst reads no file
outside it. **typst does not create the output directory**; press's stamp tool does.

press's tools are plain `sh` scripts, called the same way from any runner:

| tool | does |
|---|---|
| `sh third_party/press/tools/new.sh docs/guide` | scaffolds `docs/guide/main.typ` from the template, its import written for where press sits; add `letter` for the letter template |
| `sh third_party/press/tools/stamp.sh <doc> <pdf> <flags>` | builds, stamping the PDF with when its content last changed and keeping the old time when nothing on the page changed; makes the output directory; then audits it, where the audit's tools are installed |
| `sh third_party/press/tools/check.sh <doc> <pdf> third_party/press <flags>` | the audit alone, which refuses to run without its tools: typst warnings, fonts that are not vendored, glyphs that vanished, ink too near the edge, text printed on text |

`<flags>` are the three above: `--root . --font-path third_party/press/fonts --ignore-system-fonts`.

**Every build is audited.** A finding prints, and the build exits 1 with the PDF still written,
so a runner, CI and `all` see it and the page can still be looked at. Where the audit's tools
are missing, the build says the audit was skipped and why, and succeeds: building never
depends on them. `check.sh` is the same audit for when it must run, as in CI: without its tools
it refuses.

**A page the document did not set** — a scanned form it fills in, an embedded PDF page — is
marked with `scan(...)`. The audit then reads a copy with every scan hidden, so the scan's own
fonts, text layer and edge-to-edge ink are not findings, and what the document sets over it is
audited as usual. The copy costs a second compile, only for a document that reads an image.

**A finding a document keeps on purpose** — a sent record that will not be restyled — is
accepted in the document's own file, naming the pass and why; a file it imports or includes
cannot accept for it, since a finding a shared file causes is that file's to fix:

```typst
// press: accept ink-margin — sent 2026-03-02, kept as sent
```

Its findings still print, then a line saying they are accepted and why, and they do not fail
the build. The passes are `warnings`, `fonts`, `glyphs`, `ink-margin` and `text-on-text`. An
acceptance with no reason fails, and so does one its pass finds nothing for: left standing, it
would hide that pass's next real finding. A pass that cannot run, for a missing or broken tool,
fails the audit whatever the document accepts.

The stamp prints in **`PRESS_TZ`**, an IANA zone name set for every build
(`PRESS_TZ=America/Los_Angeles`, or `UTC` for documents read across zones), so every machine
prints the same time and an unchanged page stays unchanged wherever it is built.

### From your runner

**npm** — on Windows npm runs scripts with `cmd.exe`, where `mkdir -p` makes a folder named
`-p`; let `stamp.sh` make the output directory instead:

```json
"scripts": {
  "docs": "sh third_party/press/tools/stamp.sh docs/guide.typ print/guide.pdf --root . --font-path third_party/press/fonts --ignore-system-fonts",
  "docs:check": "sh third_party/press/tools/check.sh docs/guide.typ print/guide.pdf third_party/press --root . --font-path third_party/press/fonts --ignore-system-fonts"
}
```

**make:**

```make
FLAGS = --root . --font-path third_party/press/fonts --ignore-system-fonts
print/%.pdf: docs/%.typ
	sh third_party/press/tools/stamp.sh $< $@ $(FLAGS)
```

**just** — `press.just` is ready-made recipes for a repository that already uses just. One
line in its justfile: `import 'third_party/press/press.just'`, or `mod press
'third_party/press/press.just'` where it has recipes of its own (`import` refuses a recipe name it
already has). Then:

```sh
just build docs/guide.typ        # -> print/docs/guide.pdf, audited, and a line saying what it made
just watch docs/guide.typ        # a preview on every save -> print/docs/guide.watch.pdf
just check docs/guide.typ        # the audit, refusing without its tools
just all                         # every document under docs/, or under the directories named
just new docs/next-doc           # scaffold; just new docs/to-x letter for a letter
just clean                       # delete print/
```

Under `mod` it is `just press build …`, and `just press` lists the recipes; under `import`,
`just --list` does. `all` builds documents, not their parts: a file named `_*.typ` is a part,
and so is everything beside a `main.typ`, at any depth; it builds every one, then fails if any
failed its audit. Export `PRESS_TZ` from the justfile.

### Requirements

- **typst 0.14 or newer.** An older one is refused with a message naming both versions.
- **`sh`** for the tools. On Windows it comes with Git for Windows.
- **The audit** needs poppler (`pdffonts`, `pdftotext`, `pdftoppm`), a Python, and a grep
  with PCRE (GNU grep; on macOS, `brew install grep`); a build without them is not audited.
  Where `PATH` finds the wrong one, name it: `PRESS_PDFTOTEXT`, `PRESS_PDFFONTS`,
  `PRESS_PDFTOPPM`, `PRESS_PYTHON`, `PRESS_GREP` (`ggrep` on macOS). The audit refuses a
  `pdftotext` that is not poppler's.
- **just 1.55 or newer**, only to use `press.just`.

### On Windows

- `winget install Typst.Typst Git.Git oschwartz10612.Poppler` (and `Casey.Just` for
  `press.just`), and a Python 3 on `PATH` as `python` or `python3`.
- The tools run in Git's `sh`, in `C:\Program Files\Git\bin`. Git's default PATH choice adds
  only `Git\cmd`, which has no `sh`: add the `bin` directory to your user `PATH`.
- winget does not put poppler's programs on `PATH`, and inside `sh` Git's own Xpdf
  `pdftotext` would come first anyway. Set `PRESS_PDFTOTEXT`, `PRESS_PDFFONTS` and
  `PRESS_PDFTOPPM` in your user environment, with forward slashes, to the three programs in
  poppler's `Library/bin` (under `%LOCALAPPDATA%/Microsoft/WinGet/Packages/`).

## Writing a document

**press sets nothing until something asks.** Importing it changes no page. **Its templates are
functions a document applies**: `#show: brief.with(title: [...], author: "...")` sets the page,
the type, the show rules and the head from press's general-purpose default, and `letter` does
the same for a letter. A document uses one as it is, or a repository copies one and changes its
copy; press asks neither. `new.sh` starts a document that applies one, with placeholder text
to replace.

**A document that composes its own page** takes the parts it wants and installs the show rules
itself. One with commands in it wants the first two, and one with links the third:

```typ
#show raw: set text(font: face-mono, size: sz.micro)
#show raw.where(block: true): code
#show link: link-note
```

It **sets its body font**, `#set text(font: face-text, ...)` — without it the body renders in
typst's own Libertinus Serif, without a word — and **names itself once**, with
`#set document(title: [...], author: "...")`. A PDF viewer shows the title, and a page prints it
from `document.title`. The templates do both.

**A longer document** is a directory: `new.sh` makes `docs/handbook/main.typ`, and chapters go
beside it, `#include`d from it. Give it the reading page, `brief.with(preset: reading)`, use
typst's headings and `#outline()`, and import press in every chapter that uses its parts —
`#include` does not carry `main.typ`'s imports. **A4** is a preset with its paper changed,
`(..card, paper: "a4")`, given to `brief` as its `preset` or spread into `#set page(...)`: the
preset margins are absolute, and the audit measures them on any page size. **Landscape** is
`(..card, flipped: true)`.

**A letter** applies `letter`: `new.sh docs/to-landlord letter` starts one.
`#show: letter.with(title:, author:, contact:, date:)` **names the writer and the date once**,
sets the reading page and the letterhead, and heads page two onward with the writer, the date
and the page; the letter carries no build stamp, since its reader is outside. The body is the
letter from the recipient on, ending with `signature`, which keeps the closing on the same page
as lines for an ink signature and a date, or a typed sign-off with `signed: false`. `re` keeps
reference numbers together and `enclosures` lists what goes with the letter. To match a résumé,
pass its face (`face: face-sans`) and centre the letterhead (`centred: true`). A letter that
composes its own page uses the same parts: `letterhead`, `dateline` and `continued()`.

### The six conventions

Tokens alone do not make a document readable. These do:

1. **Meat first.** Whatever the reader must act on goes at the top.
2. **One idea per unit, opened by a bold lead.** The lead is the highlight, pre-made.
3. **Units are self-contained.** Sections get read out of order and returned to weeks later.
4. **Bands carry a role** — decide / design / reference — so skipping is deliberate.
5. **Colour is state, never decoration, and it gets a legend.**
6. **No length cap.** If a unit needs depth, give it depth or push it to a second layer — never
   delete it to fit a layout. If it does not fit, *the layout* changes.

From 1 and 6: for a document someone acts on, **the act layer comes first, the depth layer
after a `#pagebreak()`**, with an italic line saying nothing past it is needed to act. The
split is by role, not page number. The conventions are for a page read by a person: a document
whose first reader is a parser — an ATS résumé — stays single-column and takes press's tokens
and fonts, not its layout.

### Vocabulary

Tone is a string: `"note"` (slate) · `"ok"` (green) · `"warn"` (amber) · `"bad"` (red).

| Call | For |
|---|---|
| `brief(title:, author:, meta:, status:, legend: auto, preset: card)` | Template: the general-purpose document's page, type, show rules, head and footer. `#show: brief.with(...)`. |
| `letter(title:, author:, contact:, date:, face: face-text, centred: false)` | Template: a letter's page, letterhead and date, and the page-two header. `#show: letter.with(...)`. |
| `unit(label, tone, lead, body, caps:, breakable: false)` | The workhorse. One idea: label, bold lead, body. |
| `units(..items, pack: "stacks", gutter:, spacing:)` | A group of units. `"stacks"`: two columns balanced by measured height. `"grid"`: rows aligned, when the pairing means something. `"single"`: one column. |
| `band-strong(title, role, color:, caps:)` | Section header carrying its role. |
| `band(label, color: slate)` | Lighter section header. |
| `titlebar(title, meta, color:, face:, size:)` | Document head with right-aligned meta. |
| `eyebrow(body, color:, caps:)` | Small tracked-out uppercase label. |
| `chip(label, tone)` | Inline state pill — build legends from these. |
| `callout(body, tone: "note", label: none, size:)` | Aside that must not be missed. |
| `panel(body, label: none, color: slate)` | Boxed block, no tone semantics. |
| `code(body, breakable: false)` | Code-block treatment; the document installs it as a show rule. |
| `link-note` | Show rule for links: coloured and underlined, address footnoted for paper. |
| `item(n, title, body, color:, size:)` | Numbered step. |
| `matrix(head, ..rows)` | Two-column comparison table. |
| `sheet(cols, head, ..rows, size:)` | Wide data table — any column count, zebra rows, header repeats across pages. |
| `flow(..steps)` | Left-to-right stage sequence. |
| `decision(n, q, note, color: bad)` / `dbadge(n, color:)` | Open question needing an answer. |
| `seedepth(what, at: none)` | Pointer to the depth layer. Given a label it looks up the page and links to it — never type a page number. |
| `stamp(body)` | Closing line — provenance, or a last caution. |
| `updated()` | When the content last changed, as the stamp records it. For the footer. |
| `press-version` | The version of press a document was built with. Never typed by hand. |
| `scan(body)` | Marks content the document did not set, a scanned or embedded page, for the audit to leave out; what is set over it is still audited. |
| `letterhead(..contact, face: face-text)` | A letter's head: the writer (the document's author), a contact line, a rule. A link that shows its own address needs no footnote. |
| `dateline(date)` | A letter's date, written once where it prints; `continued` reads it. |
| `re(..refs, label: [Re:])` | A letter's subject line; each reference stays whole and copyable. |
| `signature(closing: none, signed: true, dated: true)` | The closing, kept on its page, then lines for an ink signature over the writer's name and a hand-written date, or with `signed: false` a typed sign-off. |
| `enclosures(..items)` | What goes with a letter, one item to a line. |
| `continued()` | A header for page two onward of a letter: writer, date, page. `set page(header: continued())`. |

**Tokens.** Colours `ink`, `ink-soft`, `ink-faint`, `rule-hair`, `rule-mid`, `paper-tint`,
`slate`, `slate-tint`, `steel`, and `ok`/`warn`/`bad` each with a `-tint`. Faces `face-text`
(Open Sans), `face-display` (Montserrat), `face-sans` (Liberation Sans), `face-mono`
(Liberation Mono) — use these, never font names as strings. Sizes `sz.micro` 8.6 · `fine` 9.4
· `small` 10.2 · `body` 11 · `lead` 12.5 · `head` 14.5 · `title` 21 · `hero` 28. Page presets
`dense`, `reading`, `card`, spread with `#set page(..card)`. When the vocabulary does not fit,
build it in the document.

### Traps

- **Fonts fail in three ways, and only one warns.** A missing *family* warns and still ships;
  a missing *weight or style* substitutes the nearest face silently; a missing *glyph* is drawn
  from typst's own fonts silently (`→` is absent from Open Sans). Only the audit catches them.
  **Read [`FONTS.md`](FONTS.md) before using any symbol.**
- **Some symbols are in no vendored face.** `✓ ✗ ▸` render from typst's NewCMMath, `⚠ ⚡ ☐`
  from DejaVuSansMono, and **`⛔` and `📋` vanish** from the page. Build a probe and audit it.
- **`unit`, `band-strong` and `eyebrow` uppercase their labels.** "pH" becomes "PH", "µS"
  becomes "ΜS" (a capital Mu). Pass `caps: false` whenever case means something.
- **A link in a heading is footnoted twice once there is an outline.** The contents repeat the
  heading and its footnote. Keep links out of headings.
- **A table that crosses a page loses its header unless it uses `table.header`.** `sheet`
  does; a hand-rolled `table()` does not.
- **Markdown habits break typst:** `**bold**` warns and vanishes (use one `*`), `+ thing` at a
  line start becomes a list, `/ thing` is a compile error. Reword rather than escape.

## Printing

Print at **100% — "Actual size"**, never "Fit to page". The presets are exactly US Letter and
keep all ink at least 0.5in from every edge; a document that overrides the margin or places
content absolutely can break that, and the audit measures it.

`calibration.typ` prints the text inks at the four smallest sizes, the pale tints, the rule
weights and both solid bands, where a printer gives out first. Build it like any document
(`third_party/press/calibration.typ`), and print it on the paper and printer you actually use —
once at normal quality and once in economy mode, duplexed on the long edge — to find where your
hardware gives out before a real document does.

## Versioning

The copy of press a repository holds is the version it builds with. Move only to a release,
never to a commit on `main` between releases. 0.1.0 was the Typst package `@vts/press:0.1.0`,
used from a git submodule at `vendor/press`. A repository moving past it removes the
submodule (`git rm vendor/press`), runs the installer in `third_party/`, and changes each
import to `/third_party/press/lib.typ`, and any other `vendor/press` path, such as a
justfile's `import`, all in one commit.

## Licence

Copyright © 2026 Tyler Vigario. **AGPL-3.0-or-later** — see [`LICENSE`](LICENSE). What you
typeset with it is yours: a compiled PDF carries no licence from the kit.

The faces under `fonts/` keep their own terms — Open Sans (Apache-2.0), Liberation
(OFL-1.1-RFN), Montserrat (OFL-1.1) — with each licence's text in `fonts/licenses/`. See
[`FONTS.md`](FONTS.md).
