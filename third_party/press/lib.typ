// press — ready-made parts and page presets for Typst documents, read on screen or on paper.
//
//   #import "/third_party/press/lib.typ": *     (or wherever press sits under the root)
//
// A document imports this file by path, and typst builds it with press's fonts:
//
//   typst compile --root . --font-path third_party/press/fonts --ignore-system-fonts <doc> <pdf>
//
// The path is the only thing a document knows about where press sits, and press is a set of
// files, not a Typst package: no namespace, no version in the import. Which press a repo
// builds with is the copy it holds; its version is in press.toml beside this file.
//
// Its composition vocabulary — `unit`, `chip`, `decision` — had
// been copy-pasted between documents before press held it. None of it was ever
// document-specific, and `unit` and `chip` had already gone byte-identical across three
// files: the drift press exists to prevent, one level down.
//

// Composition is OFFERED, never imposed. Section order, page choice, which
// diagrams exist, how deep a document layers: the templates in lib/ compose the
// parts into press's default pages, and a document applies one or composes its
// own. The library supplies vocabulary and defaults; whoever
// composes the page writes the sentence.
//
// This library is ADDITIVE, not governing. Nothing here takes effect unless a
// document calls it: importing it sets no page and installs no show rule, and a
// template applies only through a document's own #show. Whoever composes the page
// takes whichever parts serve it. That inversion is deliberate — a library that
// owned the page would force every document with real layout needs to escape it.
//
// "Not governing" limits what this library ENFORCES, never what it may OFFER. A
// styling helper a document opts into enforces nothing. Treating styling as out
// of scope leaves every document inventing its own, which is the copy-paste
// drift press exists to end. It is a helper, not a governor: documents
// vary too much for it to be anything else.
//
// Fonts are vendored in press's fonts/ directory, which every build hands to typst with
// --font-path, rather than named from the system.
// Typst does NOT perform metric substitution the way fontconfig does: on a box
// without Arial, `#set text(font: "Arial")` emits only `warning: unknown font
// family` and silently falls back to an embedded serif. Since 0.15 has no
// deny-warnings flag, that mistake ships. Hence: faces are exported constants,
// in lib/tokens.typ, so a typo is an unknown-variable ERROR, and callers pass `face-*`
// rather than a string.
//
// That covers the FAMILY level only, which is the loudest of three. A missing
// WEIGHT and a missing GLYPH each report nothing at all, and
// --ignore-system-fonts does not help because typst's own embedded fonts stay
// reachable. See the face block in lib/tokens.typ, and FONTS.md for the full account. The
// constants are stacks rather than single names for that reason, and
// the audit, tools/check.sh, is what turns the silent two into something readable.

// The files, in lib/, each importing those it is built from:
//
//   tokens.typ        colours, faces, the type scale, the page presets, press's version
//   parts.typ         the pieces a page is made of
//   composition.typ   the parts that hold a document's ideas and lay them out
//   base.typ, brief.typ, letter.typ, recipe.typ, resume.typ
//                     the templates, one to a file with the parts only it uses
//
// A document imports this file, and has them all. It is the one import press offers: the files
// in lib/ are how press is kept, and may move.

// ------------------------------------------------------------- templates ---
// press's templates: a document's page, type and head, composed from the files above, which a
// document applies with a show rule and nothing else. Each is press's universal default for a kind
// of document. A repository imports one as it is, applies it through a shared template of its own,
// or copies it and changes its copy; press says nothing about which. They stay generic: what one
// repository alone needs belongs in its own copy, and press adds another template when enough
// documents need one.

#import "lib/tokens.typ": *
#import "lib/parts.typ": *
#import "lib/composition.typ": *
#import "lib/base.typ": *
#import "lib/brief.typ": *
#import "lib/letter.typ": *
#import "lib/recipe.typ": *
#import "lib/resume.typ": *
