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
  set par(leading: 0.52em, spacing: 0.55em)
  set list(indent: 0.65em, body-indent: 0.34em, spacing: 0.32em)
  show link: link-note
  // A section is a heading: = draws it as a band in slate, and == as a labelled hairline. Its
  // gaps are the paragraph gap at the body size, since a heading's own em is its larger size.
  show heading: set block(above: 0.55 * sz.small, below: 0.55 * sz.small)
  show heading.where(level: 1): it => context {
    v(2pt)
    block(width: 100%, fill: _section-color(), inset: (x: 8pt, y: 4.5pt), radius: 1pt,
      text(size: sz.fine, weight: 700, tracking: 1.2pt, fill: white,
        if caps { upper(it.body) } else { it.body }))
    v(5pt)
  }
  // One block, so the label and its hairline are one piece: a heading drawn by a show rule
  // gets no block of its own, and loose, a page could end between them.
  show heading.where(level: 2): it => context block(breakable: false, {
    v(3pt)
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

  header(meta: (yield, method, time).filter(x => x != none).join([ · ]))
  if intro != none {
    v(3pt)
    text(size: sz.micro, fill: ink-soft, intro)
  }
  v(7pt)
  body
}
