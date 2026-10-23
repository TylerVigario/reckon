# Vendored fonts

| Family | Constant | Weights and styles vendored | Licence |
|---|---|---|---|
| Open Sans | `face-text` | Regular, Italic, Bold, BoldItalic | Apache-2.0 |
| Liberation Sans | `face-sans` | Regular, Italic, Bold, BoldItalic | OFL-1.1-RFN |
| Liberation Mono | `face-mono` | Regular, Bold — **no italic** | OFL-1.1-RFN |
| Montserrat | `face-display` | Regular, Bold — **no italic** | OFL-1.1 |

All permit redistribution. Liberation carries a Reserved Font Name — redistribute
unmodified, and do not reuse the name for a modified version. Each family's licence text is in
`fonts/licenses/`, and travels with the fonts in every release bundle.

## Why they are vendored

Typst does not perform metric substitution the way fontconfig does. On a machine without
Arial, `#set text(font: "Arial")` emits only `warning: unknown font family` and silently
ships in a fallback serif. Typst 0.15 has no deny-warnings flag, so that mistake reaches
the PDF. Vendoring plus `--ignore-system-fonts` removes the *machine's* fonts from the
picture, so output cannot vary by machine, and the exported `face-*` constants turn a
typo into an unknown-variable *error* rather than a warning.

**`--ignore-system-fonts` does not leave the vendored faces alone in the room.** Typst
carries its own embedded fonts — Libertinus Serif among them — and they remain reachable
as fallbacks under that flag. That is why the three failure modes below all survive it.

## Three ways a font goes wrong here, in ascending order of quietness

| Level | What is missing | What Typst does |
|---|---|---|
| Family | The whole family | `warning: unknown font family`, falls back |
| Weight or style | One face of a present family | **Nothing.** Nearest available face, exit 0 |
| Glyph | One codepoint in a present face | **Nothing.** That glyph alone comes from Libertinus |

Only the first one tells you. The `face-*` constants solve the family level. The stacks
below solve the glyph level. **Nothing solves the weight level except reading the table.**

### Glyph level — why the faces are stacks

Each `face-*` constant is an array: the intended face, then `Liberation Sans` as a tail.
Without the tail, a codepoint absent from the head face is drawn in Typst's embedded
Libertinus Serif — one stray serif glyph mid-sentence, no warning.

Verified: `→` (U+2192) is not in Open Sans. In body text it embedded
`LibertinusSerif-Regular`, and `LibertinusSerif-Italic` wherever the surrounding run was
italic. press's own `flow()` shipped this bug until the stacks were introduced.

**`face-mono` is the one stack whose tail changes metric class**, and that is a known
tradeoff rather than an oversight. A proportional glyph inside a monospace run nudges a
column out of alignment quietly, where a Libertinus fallback would at least look wrong on
sight — and this file argues elsewhere that quieter failures are worse. It stands because
there is no second monospace face vendored to fall back to, and losing a glyph outright is
worse than losing alignment on one character. If a mono document ever depends on column
alignment for meaning, audit it and consider vendoring a wider mono.

### The stacks narrow this hole; they do not seal it

A codepoint absent from **every** vendored face still comes from Typst's own bundled
fonts, and `--ignore-system-fonts` does not touch those. Measured on press:

| Character | Outcome |
|---|---|
| `✓` `✗` `▸`, `sym.checkmark`, `sym.crossmark` | drawn from `NewCMMath-Regular` |
| `⚠` `⚡` `☐` | drawn from `DejaVuSansMono` |
| `ℹ` | drawn from `LibertinusSerif-Regular` |
| `⛔` `📋` | **vanish** — absent from the page and from the extracted text |

All at exit 0, with no warning. The vanishing pair is the worse half: a substitution ships
the wrong glyph, a disappearance ships missing content, and a printed sheet cannot be
diffed against anything.

**So a symbol vocabulary is a vendoring decision, not a typing decision.** Before a
document commits to one — safety callouts, checkboxes, list markers — write a probe
containing every symbol it needs, build it, and audit it with `tools/check.sh`. Adopt the
symbols the vendored faces actually carry, or vendor a face that carries them and add it to
the table above.

### Scripts — where a word changes face

The stack covers a script the head face lacks letter by letter, so a word can change face
partway. Open Sans carries Latin, Cyrillic and monotonic Greek (τέκνον), but not polytonic
Greek — the breathing marks of Greek Extended, U+1F00–1FFF — and not Hebrew. Liberation Sans
carries both, so `ἀφίενταί` in body text draws its first letter from Liberation Sans and the
rest from Open Sans, and a line of Hebrew comes from Liberation Sans entirely. Exit 0, and the
audit passes, because both faces are vendored. Measured with `fc-query` on the kit's own files,
letters carried of each block:

| Block | Open Sans | Liberation Sans | Montserrat |
|---|---|---|---|
| Greek and Coptic, U+0370–03FF (144) | 75 | 127 | 8 |
| Greek Extended, U+1F00–1FFF (256) | 1 | 233 | 0 |
| Hebrew, U+0590–05FF (112) | 0 | 87 | 0 |
| Cyrillic, U+0400–04FF (256) | 255 | 256 | 222 |

A passage in polytonic Greek or Hebrew is set in `face-sans`, `#text(font: face-sans)[…]`,
so each word stays in one face. A document that sets these scripts throughout needs a face
that carries them, vendored and added to the table above.

### Weight level — the table above is a constraint, not an inventory

**Requesting a weight or style that is not vendored fails silently and completely.** The
family name is correct, so nothing warns — Typst picks the nearest face it has, and the
build exits 0.

Verified: with only `Montserrat-Bold` present, `#text(font: face-display, weight: 400)`
produced a PDF whose sole embedded face was `Montserrat-Bold` — no warning, exit 0.
Montserrat Regular is now vendored for that reason, but the class of bug remains for every
weight that is not in the table, and the stacks do not help here — a *family* is present,
so the fallback chain is never consulted.

So **check the table before using a weight or style.** An italic in `face-mono`, or
Montserrat at 300 or 600, means vendoring that file first — add it here in the same commit,
or the next person inherits a silent fallback.

The cheap check on any finished document:

```sh
pdffonts print/docs/thing.pdf
```

Every face listed should be one you intended. An unexpected name, or a missing one you
expected, is the bug — and it is invisible by any other means.
