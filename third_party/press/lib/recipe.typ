// The recipe template: a recipe card.
// A template is composed from tokens, parts and composition, and never from another template, so
// it can be read, or copied, on its own.

#import "tokens.typ": *
#import "parts.typ": *

// A recipe card: the card page, a header naming the dish with its yield, method and time, and a
// line of introduction under it. The body is the cook and then the reference: the ingredients
// and the method first, then the reference, and writein() for what the cook changed. A card
// marks where its reference starts with typst's own label, <depth>, on the heading that opens
// it, and recipe starts it on a page of its own under `depth`, a line saying page one is the
// whole cook; none prints no line. A section is a heading, `= Method`, drawn as a band, and `==`
// is a labelled hairline under it; `caps: false` keeps the headings' case, which upper() would
// change. `footer` is the footer: none leaves it out.
//
//   #show: recipe.with(title: [Black beans], yield: [serves 8], method: [stovetop],
//     time: [about 40 min], intro: [A pot of beans for the week.])
#let recipe(
  title: none, author: (), yield: none, method: none, time: none, intro: none, preset: card,
  footer: footer(), caps: true,
  depth: [Nothing past this point is needed to cook. Page 1 is the whole job.],
  body,
) = {
  set document(title: title, author: author)
  set page(..preset, footer: footer)
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
  // A section is a heading: = draws it as a band in the section's colour, slate unless
  // section(color:) says otherwise, and == as a labelled hairline. Its gaps are the paragraph gap
  // at the body size, since a heading's own em is its larger size.
  show heading: set block(above: 0.8 * sz.small, below: 0.8 * sz.small)
  show heading.where(level: 1): it => context {
    v(2pt)
    block(width: 100%, fill: _section-color(), inset: (x: 8pt, y: 4.5pt), radius: 1pt,
      text(size: sz.fine, weight: 700, tracking: 1.2pt, fill: white, {
        let shape = _section-shape()
        if shape != none [#_shape(shape, white)#h(0.4em)]
        if caps { upper(it.body) } else { it.body }
      }))
    v(5pt)
  }
  // One block, so the label and its hairline are one piece: a heading drawn by a show rule
  // gets no block of its own, and loose, a page could end between them.
  show heading.where(level: 2): it => context block(breakable: false, {
    // The label sits over its hairline by the part's own gap, at the body size as the heading's
    // gaps are: the heading's own block spacing would reach the hairline too.
    set block(spacing: 0.55 * sz.small)
    v(3pt)
    let shape = _section-shape()
    if shape != none [#_shape(shape, _section-color())#h(0.35em)]
    eyebrow(it.body, color: _section-color(), caps: caps)
    v(-2pt)
    line(length: 100%, stroke: 0.7pt + rule-hair)
    v(3pt)
  })
  show <depth>: it => {
    pagebreak(weak: true)
    if depth != none {
      text(size: sz.fine, style: "italic", fill: ink-soft, depth)
      v(6pt)
    }
    it
  }

  // The title is counted here when nothing in the document prints it.
  _title-start()
  // The head, its header and intro, is one part, with the part's own gaps inside.
  block(width: 100%, {
    set par(spacing: _part-gap)
    header(meta: (yield, method, time).filter(x => x != none).join([ · ]))
    if intro != none {
      v(3pt)
      text(size: sz.micro, fill: ink-soft, intro)
    }
  })
  v(7pt)
  body
}
