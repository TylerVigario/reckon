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
  set par(leading: 0.52em, spacing: 0.55em)
  set list(indent: 0.65em, body-indent: 0.34em, spacing: 0.32em)
  show raw: set text(font: face-mono, size: sz.fine)
  show raw.where(block: true): code
  show link: link-note
  body
}
