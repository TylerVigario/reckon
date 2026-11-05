// The base template: press's defaults for a page a document lays out itself.
// A template is composed from tokens, parts and composition, and never from another template, so
// it can be read, or copied, on its own.

#import "tokens.typ": *
#import "parts.typ": *

// The bare setup, for a document that lays out its own page: press's defaults for the page, the
// type and the rules for code and links, and the document's title and author, with nothing
// drawn. Like every template it keeps its own lines, so it can be read, or copied, on its own.
// A set rule written after it changes any of these for the document it is in:
// `#set par(leading: 0.58em)` after the show rule wins over base's own.
//
//   #show: base.with(title: [Rack power], author: "Your name", preset: dense)
#let base(title: none, author: (), preset: card, body) = {
  set document(title: title, author: author)
  set page(..preset)
  set text(font: face-text, size: sz.small, fill: ink, lang: "en")
  // Paragraphs further apart than a list's items, and items than lines, so each reads as one:
  // a paragraph ends where its gap shows, and the one after a list is not its last item's.
  set par(leading: 0.52em, spacing: 0.8em)
  // A list's items are further apart than the lines within one, so a wrapped item reads as one.
  set list(indent: 0.65em, body-indent: 0.34em, spacing: 0.65em)
  set enum(spacing: 0.65em)
  // Code is set a step below the text around it, as sz.fine is to sz.small; typst's own rule for
  // raw sets it at 0.8em first, which this is relative to.
  show raw: set text(font: face-mono, size: sz.fine / sz.small / 0.8 * 1em)
  show raw.where(block: true): code
  show link: link-note
  // The title is counted here when nothing in the document prints it.
  _title-start()
  body
}
