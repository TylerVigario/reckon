// press's composition vocabulary: the parts that hold a document's ideas and lay them out.

#import "tokens.typ": *
#import "parts.typ": *

// ----------------------------------------------------------- composition ---
// Generic by nature — a labelled bounded block, a state chip, a question awaiting its answer.

// The workhorse. A bounded unit of exactly one idea: a label to navigate by, a
// bold LEAD that is the highlight pre-made, and a body as long as the idea
// actually needs. There is no length cap on purpose — capping length lets the
// format decide what the reader is allowed to know.
// `caps` forwards to the label's `eyebrow` — see the note on it in parts.typ. This is the
// most-used call in the vocabulary, so it is where the uppercasing does the most
// damage: `unit([pH], "warn")` renders "PH" with nothing to indicate it happened. A unit
// `breakable: true` lets break keeps its label with the lead, as a callout does.
#let unit(label, tone, lead, body, caps: true, breakable: false) = {
  let pair = tones.at(tone)
  block(width: 100%, breakable: breakable, stroke: (left: 2.5pt + pair.at(0)),
        fill: paper-tint, inset: (x: 8pt, y: 6.5pt))[
    #text(size: sz.fine, block(sticky: true, eyebrow(label, color: pair.at(0), caps: caps)))
    #v(2.5pt)
    #text(size: sz.fine, weight: 700)[#lead]
    #if body != none [ #v(2.5pt) #text(size: sz.fine)[#body] ]
  ]
}

// Inline state marker — use in a legend so colour reads as meaning.
#let chip(label, tone) = {
  let pair = tones.at(tone)
  box(fill: pair.at(1), stroke: 0.5pt + pair.at(0), inset: (x: 4pt, y: 2pt), radius: 1pt,
      text(size: sz.micro, weight: 700, fill: pair.at(0))[#label])
}

// A question with its note, under its number in a filled badge — for anything the reader must
// answer.
#let decision(n, q, note, color: bad) = block(
  width: 100%, breakable: false, inset: (bottom: 5.5pt),
)[
  #grid(columns: (auto, 1fr), gutter: 6pt, align: (left + top, left + top),
    box(fill: color, radius: 50%, inset: (x: 4.5pt, y: 3pt),
      text(size: sz.fine, weight: 700, fill: white)[#n]),
    [
      #text(size: sz.fine, weight: 700)[#q]
      #v(1.5pt)
      #text(size: sz.fine, fill: ink-soft)[#note]
    ])
]

// Room for a pen: ruled paper spaces its lines 7 to 9 mm apart, and 8 mm takes ordinary
// handwriting. A blank table row is otherwise only as tall as its inset, about 3 mm.
#let _pen = 8mm

// The line a pen writes on, under a signature, a date or a note.
#let _hand-line = line(length: 100%, stroke: 0.5pt + ink)

// A table of any number of columns, two or twenty: `#sheet((auto, 1fr), ([Item], [Amount]), ..)`.
//
// `cols` is passed through to `table.columns` so the document keeps control of
// widths. Header row is bold on a slate tint, body rows zebra-striped.
//
// `size` exists because a fixed size pushed documents into writing their own per-cell
// wrapper just to get a different one.
//
// The header goes through `table.header`, so the PDF marks it as one, a screen reader reads it
// as the column labels rather than as data, and it repeats on every page the table spans.
// Without it a table crossing a page break leaves the reader with bare rows and no column
// labels — and on paper there is no scrolling back.
//
// `blank` adds that many empty rows after the given ones, each tall enough to write in, for a
// log filled in by hand: `#sheet((auto, auto, 1fr), ([Date], [Size], [Notes]), blank: 6)`.
#let sheet(cols, head, size: sz.micro, blank: 0, ..rows) = {
  let inset = (x: 5pt, y: 4pt)
  let n = if type(cols) == int { cols } else { cols.len() }
  table(
    columns: cols,
    stroke: 0.4pt + rule-hair,
    inset: inset,
    fill: (_, y) => if y == 0 { slate-tint } else if calc.odd(y) { paper-tint } else { none },
    table.header(..head.map(h => text(size: size, weight: 700)[#h])),
    ..rows.pos().map(c => text(size: size)[#c]),
    ..range(blank * n).map(_ => box(height: _pen - 2 * inset.y)),
  )
}

// Lines to write on by hand, `n` of them, `pitch` apart, each after `label` where one is given:
// `#writein(3, label: [date])` for dated notes. They print; a PDF viewer cannot fill them, since
// typst writes no PDF form fields.
#let writein(n, label: none, pitch: _pen) = {
  assert(type(n) == int and n > 0, message: "writein() needs a number of lines, 1 or more")
  let row = if label == none { (_hand-line,) } else {
    (text(size: sz.micro, fill: ink-soft, label), _hand-line)
  }
  grid(columns: if label == none { (1fr,) } else { (auto, 1fr) },
    rows: pitch, column-gutter: 6pt, align: bottom,
    ..range(n).map(_ => row).flatten())
}

// Where a document is signed, with its closing (`closing: [Sincerely,]`) kept on the same page, so
// a page break never strands it. By default, space for an ink signature over a line with the
// signer's name beneath, and beside it a line to date by hand (`dated: false` leaves that out).
// For a document sent as a file, `signed: false` is a typed sign-off: the name alone.
//
// `name` is who signs, the document's author unless it is given. A document several people sign
// calls it once for each, with their names, and places them itself: with its date line a
// signature is 4.4in wide, so two go one above the other on a letter's page, not side by side.
//
//   #signature(name: [Pat Example])
//   #signature(name: [Sam Example], dated: false)
#let signature(
  name: auto, closing: none, signed: true, dated: true, words: (date: [Date]),
) = block(breakable: false, context {
  let name = if name == auto { _writer(what: "signature(), given no name,") } else { name }
  if closing != none { closing }
  if not signed {
    if closing != none { parbreak() }
    name
  } else {
    let slot(caption) = stack(spacing: 5pt, _hand-line, caption)
    v(0.55in)
    grid(columns: if dated { (2.6in, 0.4in, 1.4in) } else { (2.6in,) },
      slot(name), ..if dated { ([], slot(_words("signature", words, "date").date)) } else { () })
  }
})

// Lay out a set of units. This sets no page; it owns only how a GROUP packs,
// which is the one thing every document was re-deriving by hand.
//
//   "stacks"  two columns filled independently and balanced by MEASURED height.
//             Nothing is padded to match a neighbour, which is the failure of a
//             row grid: a row is as tall as its tallest cell, so a short unit
//             beside a long one leaves the gap under it.
//   "grid"    row-major cells. Keeps units aligned across a row — correct when
//             the pairing means something, and the source of that gap when it
//             does not.
//   "single"  one column, full width.
//
// Balancing measures at the real column width inside `layout`, because a unit's
// height depends on where it wraps. Counting source lines guesses at that and is
// wrong wherever prose wraps differently from markup.
#let units(..items, pack: "stacks", gutter: 9pt, spacing: 6pt) = {
  // Fail on an unknown value rather than falling through. `pack: "stack"` would
  // otherwise render the default and look deliberate, which is the failure mode
  // press is meant to make loud.
  assert(pack in ("stacks", "grid", "single"),
         message: "units(pack:) expects \"stacks\", \"grid\" or \"single\"; got \"" + pack + "\"")
  let us = items.pos()
  let stack(col) = {
    for (i, u) in col.enumerate() {
      u
      if i + 1 < col.len() { v(spacing) }
    }
  }

  if us.len() == 0 { return }
  if pack == "single" { return stack(us) }
  if pack == "grid" {
    return grid(columns: (1fr, 1fr), gutter: gutter, row-gutter: spacing, ..us)
  }

  // pack == "stacks", guaranteed by the assert above.
  layout(size => {
    let w = (size.width - gutter) / 2
    let left = ()
    let right = ()
    let hl = 0pt
    let hr = 0pt
    for u in us {
      let h = measure(box(width: w, u)).height
      if hl <= hr { left.push(u); hl += h } else { right.push(u); hr += h }
    }
    grid(columns: (1fr, 1fr), gutter: gutter, align: top,
         stack(left), stack(right))
  })
}
