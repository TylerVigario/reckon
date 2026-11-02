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

// The shape each tone draws beside a state, so the state reads without its colour. Printed in
// grey, ok and warn come out nearly the same, about 96 and 102 of 255 in Rec. 601 luma, and on
// paper colour alone carries nothing that a monochrome printer or a reader's eyes may lose.
#let _tone-shapes = (note: "diamond", ok: "circle", warn: "triangle", bad: "square")

// A shape filled with `color`, about as tall as a capital, centred on the capitals of the text it
// sits in, as checkbox() centres on the lowercase. Each is drawn to look the same size as the
// others, so a square is a little smaller than a circle and a triangle a little wider.
#let _shape(name, color) = context {
  let cap = measure(text(top-edge: "cap-height", bottom-edge: "baseline")[X]).height
  let s = 0.85 * cap
  let drawn = if name == "circle" { circle(radius: s / 2, fill: color) }
    else if name == "square" { square(size: 0.88 * s, fill: color) }
    else if name == "triangle" { polygon(fill: color, (0pt, s), (0.6 * s, 0pt), (1.2 * s, s)) }
    else { polygon(fill: color, (0.6 * s, 0pt), (1.2 * s, 0.6 * s), (0.6 * s, 1.2 * s), (0pt, 0.6 * s)) }
  let h = measure(drawn).height
  box(baseline: h / 2 - cap / 2, drawn)
}

// A state, shown by its tone's colour and its shape: the circle is ok, the triangle warn, the
// square bad, the diamond note. Boxed, it is a pill with its label, for a legend:
// `chip([MATCHES], "ok")`. `boxed: false` sets the shape and the label alone, bold in the tone's
// colour at the size of the text around it, for a value in a table whose every cell has a state,
// where a pill in each would be too heavy: `chip([4], "ok", boxed: false)`. The legend's pills
// draw the same shapes, so a reader matches a cell to its state on a grey printout too.
// `shape` changes the tone's shape, "circle", "triangle", "square" or "diamond", and none leaves
// it out.
#let chip(label, tone, boxed: true, shape: auto) = {
  let pair = tones.at(tone)
  let shape = if shape == auto { _tone-shapes.at(tone) } else { shape }
  assert(shape == none or shape in _tone-shapes.values(),
    message: "chip(shape:) expects \"circle\", \"triangle\", \"square\", \"diamond\" or none; got "
      + repr(shape))
  let shown = if shape == none { label } else [#_shape(shape, pair.at(0))#h(0.3em)#label]
  if boxed {
    box(fill: pair.at(1), stroke: 0.5pt + pair.at(0), inset: (x: 4pt, y: 2pt), radius: 1pt,
        text(size: sz.micro, weight: 700, fill: pair.at(0), shown))
  } else {
    text(weight: 700, fill: pair.at(0), shown)
  }
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

// How far below the page's top edge its text area starts, as typst places it: a relative margin
// is of the page's height, and auto is typst's 2.5/21 of the page's shorter side. Read in context.
#let _text-top() = {
  let m = page.margin
  let top = if type(m) == dictionary { m.at("top", default: auto) } else { m }
  if top == auto { 2.5 / 21 * calc.min(page.width, page.height) }
  else if type(top) == ratio { top * page.height }
  else if type(top) == relative { top.ratio * page.height + top.length.to-absolute() }
  else { top.to-absolute() }
}

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
//
// `across` sets the sheet in that many columns, `gutter` apart, for a long, narrow list that would
// otherwise fill half the page's width: `#sheet((1fr, auto), ([Room], [Key]), across: 2, ..keys)`.
// It reads down each column, then the next, then the next page, with the header atop every column.
// typst flows the full pages, which keeps that order, but cannot balance columns, so where the sheet
// ends press splits its last rows between the columns by their measured height, not their count,
// and the columns end level, a row that wraps counted at its height. A sheet that fits on one page
// is balanced the same way.
#let sheet(cols, head, size: sz.micro, blank: 0, across: 1, gutter: 9pt, ..rows) = {
  assert(type(across) == int and across >= 1,
    message: "sheet(across:) takes a number of columns, 1 or more; got " + repr(across))
  let inset = (x: 5pt, y: 4pt)
  let n = if type(cols) == int { cols } else { cols.len() }
  let cells = (
    ..rows.pos().map(c => text(size: size)[#c]),
    ..range(blank * n).map(_ => box(height: _pen - 2 * inset.y)),
  )
  // The sheet, or the part of it a column holds: `before` rows come ahead of these, so the
  // stripes run on from column to column.
  let part(cells, before: 0) = table(
    columns: cols,
    stroke: 0.4pt + rule-hair,
    inset: inset,
    fill: (_, y) => if y == 0 { slate-tint }
      else if calc.odd(y + before) { paper-tint } else { none },
    table.header(..head.map(h => text(size: size, weight: 700)[#h])),
    ..cells,
  )
  if across == 1 or cells.len() == 0 { return part(cells) }

  let lines = range(0, cells.len(), step: n).map(i => cells.slice(i, calc.min(i + n, cells.len())))
  layout(region => context {
    let w = (region.width - gutter * (across - 1)) / across
    let head-h = measure(block(width: w, part(()))).height
    let tall = lines.map(l => measure(block(width: w, part(l))).height - head-h)
    // A column's height on a full page, and on the page the sheet starts on, what is left of it.
    // Measured, as inside units(), the height has no end, and the sheet is one page.
    let full = region.height
    let first = if full.pt() == calc.inf { full } else {
      full - (here().position().y - _text-top())
    }

    // The page each row lands on, filling as typst's columns do: a column takes rows while they
    // fit, and the sheet moves on from a column too short for its header and first row. A row
    // taller than a whole page's column goes where it is, as typst breaks it there.
    let room(leaf) = (if leaf == 0 { first } else { full }) - head-h
    let leaf = 0
    let col = 0
    let used = 0pt
    let on = ()
    for h in tall {
      while used + h > room(leaf) and not (used == 0pt and leaf > 0) {
        used = 0pt
        col += 1
        if col == across { col = 0; leaf += 1 }
      }
      on.push(leaf)
      used += h
    }

    // The last page's rows, shared between its columns by height. `most` is the shortest the
    // tallest column can be, found by halving between what an even share would be and all of
    // them. Then each column takes rows until it holds its share of what is left, never past
    // `most`, so where the rows cannot come out even, an earlier column is the longer.
    let t = on.position(p => p == leaf)
    let rest = tall.slice(t)
    let total = rest.sum()
    let slack = 0.01pt
    let needs(most) = {
      let count = 1
      let held = 0pt
      for h in rest {
        if held > 0pt and held + h > most + slack { count += 1; held = 0pt }
        held += h
      }
      count
    }
    let low = calc.max(..rest, total / across)
    let most = total
    for _ in range(24) {
      let mid = (low + most) / 2
      if needs(mid) <= across { most = mid } else { low = mid }
    }
    let shares = ()
    let i = 0
    for c in range(across) {
      let share = rest.slice(i).sum(default: 0pt) / (across - c)
      let held = 0pt
      let from = i
      while i < rest.len() and (c == across - 1
          or (held < share - slack and held + rest.at(i) <= most + slack)) {
        held += rest.at(i)
        i += 1
      }
      shares.push(range(from, i))
    }
    let fits = shares.all(s => s.map(i => rest.at(i)).sum(default: 0pt) <= room(leaf) + slack)

    let flowed = if t > 0 { (part(lines.slice(0, t).flatten()), colbreak()) } else { () }
    let ending = if not fits { (part(lines.slice(t).flatten(), before: t),) } else {
      shares.filter(s => s.len() > 0).map(s =>
        part(s.map(i => lines.at(t + i)).flatten(), before: t + s.first())
      ).intersperse(colbreak())
    }
    columns(across, gutter: gutter, (..flowed, ..ending).join())
  })
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

// A box to tick by hand, sized in em so it follows the text it sits in: inline, in a sheet()
// cell, or as a list's marker, where the list gives a checklist its hanging indent.
// It is centred on the face's x-height, measured, so it sits with the lowercase beside it in any
// face. press draws it because ☐ is in no vendored face. `checked: true` marks it with an X, as
// tick() does, for a copy filled in ahead of time. The audit does not count an empty box, unlike
// an open item: on paper, an empty box is what the reader is there to fill.
//
//   #set list(marker: checkbox())
//   - Shut the water off at the street.
#let checkbox(checked: false, size: 0.7em, stroke: 0.6pt + ink, radius: 1pt) = context {
  let x = measure(text(top-edge: "x-height", bottom-edge: "baseline")[x]).height
  box(width: size, height: size, baseline: size / 2 - x / 2, stroke: stroke, radius: radius,
    if checked { place(center + horizon,
      text(size: size, weight: 700, top-edge: "cap-height", bottom-edge: "baseline")[X]) })
}

// Where a document is signed, with its closing (`closing: [Sincerely,]`) kept on the same page, so
// a page break never strands it. By default, space for an ink signature over a line with the
// signer's name beneath, and beside it a line to date by hand (`dated: false` leaves that out).
// For a document sent as a file, `signed: false` is a typed sign-off: the name alone.
//
// `name` is who signs, the document's author unless it is given. A document several people sign
// calls it once for each, with their names, and places them itself. With its date line beside, a
// signature is 4.4in wide, too wide for two side by side, so the arrangement is the document's:
//
//   `width` is the ink line's length, 2.6in by default. A relative width is of the room the line
//   has, which beside a date line is what the date leaves: `width: 100%` fills a grid's cell.
//   `dated` is true for the date line beside the name's, "below" for it under the name, with a
//   pen's room above it, or false for none. The date line is 1.4in either way, so it never reads
//   as a second line to sign.
//
// Two signers side by side, each with a date, fit any of press's measures:
//
//   #grid(columns: (1fr, 1fr), gutter: 22pt,
//     signature(name: [Pat Example], width: 100%, dated: "below"),
//     signature(name: [Sam Example], width: 100%, dated: "below"))
//
//   #signature(name: [Pat Example])
//   #signature(name: [Sam Example], dated: false)
#let signature(
  name: auto, closing: none, signed: true, dated: true, width: 2.6in, words: (date: [Date]),
) = block(breakable: false, context {
  // An unknown arrangement fails rather than falling through to one that looks deliberate.
  assert(dated in (true, false, "below"),
    message: "signature(dated:) expects true, false or \"below\"; got " + repr(dated))
  assert(type(width) in (length, ratio, relative),
    message: "signature(width:) takes a length or a relative width: width: 2.9in, width: 100%")
  let name = if name == auto { _writer(what: "signature(), given no name,") } else { name }
  if closing != none { closing }
  if not signed {
    if closing != none { parbreak() }
    name
  } else {
    let slot(caption) = stack(spacing: 5pt, _hand-line, caption)
    let date = slot(_words("signature", words, "date").date)
    v(0.55in)
    layout(size => {
      // The room the ink line has: all of it, or what a date line beside it leaves.
      let room = if dated == true { size.width - 1.8in } else { size.width }
      let ink = if type(width) == ratio { width * room }
        else if type(width) == relative { width.ratio * room + width.length.to-absolute() }
        else { width.to-absolute() }
      if dated == "below" {
        stack(block(width: ink, slot(name)), _pen, block(width: 1.4in, date))
      } else {
        grid(columns: if dated { (ink, 0.4in, 1.4in) } else { (ink,) },
          slot(name), ..if dated { ([], date) } else { () })
      }
    })
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
