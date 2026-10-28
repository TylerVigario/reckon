// press's tokens: colours, faces, the type scale and the page presets, and the version of
// press, read from press.toml. Every other file in lib/ imports this one.

// The oldest typst press works with, from press.toml. Read as files rather than as a package,
// nothing else would refuse an older typst, which would instead fail on whatever it lacks.
#let _manifest = toml("../press.toml")
#assert(sys.version >= version(.._manifest.typst.split(".").map(int)),
  message: "press needs typst " + _manifest.typst + " or newer; this is typst "
    + str(sys.version))

// The version of press a document was set with, read from press.toml in press's folder, so a
// page that prints it always names the press it was built with. Not `version`: that is
// typst's own, and `import *` would shadow it.
#let press-version = _manifest.version

// ---------------------------------------------------------------- tokens ---

// Ink & rules
//
// Contrast on white, measured, because a page must read on PAPER too, and a
// screen flatters grey that toner does not. Toner also gains — small type prints
// slightly heavier and lighter in colour than it renders — so screen-legible is
// the floor here, not the target.
//
//   ink        17.85:1   body
//   ink-soft    8.33:1   secondary
//   ink-faint   6.40:1   tertiary  — started at 3.04, below the 4.5:1 body floor;
//                                    5.51 still read as unpleasant on paper, so it
//                                    was lifted again against a printed sheet
//
// ink-faint was the reported failure: the lightest ink, at the smallest size,
// in italic, doing real work (stamp()'s closing line, and the footer). Three
// legibility costs stacked on the same run. It is now above the body floor with
// room to spare, and the hierarchy still reads because the gaps between the
// three stayed wide.
#let ink = rgb("#0f172a")
#let ink-soft = rgb("#454f5b")
#let ink-faint = rgb("#55606d")
#let rule-hair = rgb("#c3cbd4")
#let rule-mid = rgb("#a3aeba")
#let paper-tint = rgb("#f5f7f9")

// Accents
#let slate = rgb("#1a4e8a")
#let slate-tint = rgb("#e7eef6")
#let steel = rgb("#41566b")

// Semantic
#let ok = rgb("#2e7d4f")
#let ok-tint = rgb("#e6f2ea")
#let warn = rgb("#a05a0e")
#let warn-tint = rgb("#f9efdf")
#let bad = rgb("#a3271d")
#let bad-tint = rgb("#f7e6e4")

// Faces — constants, never strings at the call site (see header).
//
// Each is a STACK: the head is the intended face, the tail is a vendored
// fallback for glyphs the head does not carry. The tail is not cosmetic. Typst
// falls back PER GLYPH to its own bundled LibertinusSerif when the requested
// family lacks a codepoint — silently, no warning, exit 0 — so a sans document
// ships stray serif glyphs and nothing says so. Verified: U+2192 (→) is absent
// from Open Sans, and `→` in body text embedded LibertinusSerif-Regular, plus
// LibertinusSerif-Italic wherever the surrounding text was italic.
//
// Liberation Sans is the tail because it is already vendored and its coverage
// is broad. Mono falls back to Liberation Mono's own sans sibling rather than
// to a serif: the wrong width beats the wrong species.
#let face-sans = ("Liberation Sans",)
#let face-text = ("Open Sans", "Liberation Sans")
#let face-display = ("Montserrat", "Liberation Sans")
#let face-mono = ("Liberation Mono", "Liberation Sans")

// Type scale — pick a step rather than inventing a size inline.
//
// Sized for PAPER, not for a screen you can zoom. The first print of a real
// document came back "text is too small": the previous scale started at 7.6pt
// and put body at 9.6pt, which reads fine at 150% on a monitor and is mean at
// arm's length on a sheet. Every step moved up roughly 13%, keeping the ratios.
//
// A document that no longer fits after this should change its layout or its page
// preset — it must not drop back down the scale. Type too small to read
// comfortably is not a document that fits; it is one that failed in a way that
// only shows up on paper.
#let sz = (
  micro: 8.6pt, fine: 9.4pt, small: 10.2pt, body: 11pt,
  lead: 12.5pt, head: 14.5pt, title: 21pt, hero: 28pt,
)

// Page geometry presets. Spread at the call site — `#set page(..dense)` —
// so the page is visibly set where it is composed.
//
// Sized so that PRINTING AT 100% IS SAFE. The page is exactly US Letter, so
// "actual size" needs no scaling — but consumer printers cannot print to the
// paper edge, and that unprintable band is set in hardware with no dialog
// option on most of them. Everything here therefore keeps ink at least 0.5in
// from every edge, which clears the dead band on ordinary lasers and inkjets
// alike. "Fit to page" is then never necessary, and should never be used: it
// scales the sheet down and undoes the type sizes above.
//
// The bottom margin is deliberately larger than the top. The footer sits INSIDE
// the bottom margin, so a symmetric margin puts the footer closer to the edge
// than anything else on the page — measured at 0.23in while the margin claimed
// 0.5in, which is inside the dead band on most hardware. footer-descent is
// pinned here rather than left at its 30%-of-margin default, so the clearance
// is a fixed number instead of a consequence of the margin.
#let dense = (
  paper: "us-letter", margin: (x: 1.5cm, top: 1.4cm, bottom: 1.95cm),
  footer-descent: 0.35cm,
)
#let reading = (
  paper: "us-letter", margin: (x: 1.05in, top: 0.95in, bottom: 1.05in),
  footer-descent: 0.2in,
)
#let card = (
  paper: "us-letter", margin: (x: 0.55in, top: 0.55in, bottom: 0.75in),
  footer-descent: 0.12in,
)
