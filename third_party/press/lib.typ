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
// Its composition vocabulary — `unit`, `chip`, `band-strong`, `dbadge`, `decision` — had
// been copy-pasted between documents before press held it. None of it was ever
// document-specific, and `unit` and `chip` had already gone byte-identical across three
// files: the drift press exists to prevent, one level down.
//
// The oldest typst press works with, from press.toml. Read as files rather than as a package,
// nothing else would refuse an older typst, which would instead fail on whatever it lacks.
#let _manifest = toml("press.toml")
#assert(sys.version >= version(.._manifest.typst.split(".").map(int)),
  message: "press needs typst " + _manifest.typst + " or newer; this is typst "
    + str(sys.version))

// Composition is OFFERED, never imposed. Section order, page choice, which
// diagrams exist, how deep a document layers: the templates at the end of this
// file compose the parts into press's default pages, and a document applies one
// or composes its own. The library supplies vocabulary and defaults; whoever
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
// deny-warnings flag, that mistake ships. Hence: faces are exported constants
// below, so a typo is an unknown-variable ERROR, and callers pass `face-*`
// rather than a string.
//
// That covers the FAMILY level only, which is the loudest of three. A missing
// WEIGHT and a missing GLYPH each report nothing at all, and
// --ignore-system-fonts does not help because typst's own embedded fonts stay
// reachable. See the face block below, and FONTS.md for the full account. The
// constants are stacks rather than single names for that reason, and
// the audit, tools/check.sh, is what turns the silent two into something readable.

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
// in italic, doing real work (the seedepth pointers and the footer). Three
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
// A document that no longer fits after this should lose content to its depth
// layer, or change page preset — it must not drop back down the scale. Type too
// small to read comfortably is not a document that fits; it is one that failed
// in a way that only shows up on paper.
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

// ----------------------------------------------------------------- parts ---

// `caps` is opt-out because upper() CORRUPTS case-carrying strings, and silently:
// "pH" becomes "PH", "iOS" becomes "IOS", and "µS" becomes "ΜS" — micro-sign
// turned into capital Mu, a different character entirely. Pass `caps: false`
// whenever the case of the label means something.
#let eyebrow(body, color: slate, caps: true) = text(
  size: sz.fine, weight: 700, tracking: 1.2pt, fill: color,
  if caps { upper(body) } else { body },
)

// Title row: name left, dateline right, rule beneath.
#let titlebar(title, meta, color: slate, face: face-display, size: sz.title) = {
  grid(
    columns: (auto, 1fr),
    align: (left + bottom, right + bottom),
    text(font: face, size: size, weight: 700, fill: ink)[#title],
    text(size: sz.fine, fill: ink-soft)[#meta],
  )
  v(-3pt)
  line(length: 100%, stroke: 1.6pt + color)
}

// A labelled hairline — cheaper than a heading when the label is enough.
#let band(label, color: slate) = {
  v(3pt)
  eyebrow(label, color: color)
  v(-2pt)
  line(length: 100%, stroke: 0.7pt + rule-hair)
  v(3pt)
}

#let tones = (
  note: (slate, slate-tint), ok: (ok, ok-tint),
  warn: (warn, warn-tint), bad: (bad, bad-tint),
)

// Tinted callout with a weighted left edge.
#let callout(body, tone: "note", label: none, size: sz.small) = {
  let pair = tones.at(tone)
  block(
    width: 100%, fill: pair.at(1), stroke: (left: 3pt + pair.at(0)),
    inset: (x: 10pt, y: 8pt),
  )[
    #if label != none [#eyebrow(label, color: pair.at(0)) #v(3pt)]
    #text(size: size)[#body]
  ]
}

// Bordered panel — for grids where a tint would shout.
#let panel(body, label: none, color: slate) = block(
  width: 100%, stroke: 0.6pt + rule-mid, inset: 10pt, radius: 1pt,
)[
  #if label != none [#eyebrow(label, color: color) #v(4pt)]
  #body
]

// Code block treatment. The document installs it; press never does:
//
//   #show raw: set text(font: face-mono, size: sz.micro)
//   #show raw.where(block: true): code
//
// Shading and a border, commands as plain lines, nothing per line. That is what
// documentation actually does — Google's developer style guide, MDN and GitLab
// all describe one block for related sequential commands — and it is what a
// reader recognises as a command listing without being taught.
//
// NOTHING PER LINE, deliberately, and for two reasons that are not aesthetic.
//
// It is not a convention anywhere. No style guide frames each command, and a
// reader meeting an invented pattern has to work out what it means first.
//
// It costs the reader their selection. Framing each command in its own box was
// tried on a real sheet and a PDF reader then highlighted the whole group when
// one command was clicked, forcing the reader to drag by hand. These sheets are
// read on screen as well as on paper. The mechanism inside the PDF was not
// established — the obvious candidates were measured and ruled out — but the
// behaviour was observed directly, and it is enough to settle the design.
//
// NO PROMPT AND NO LANGUAGE LABEL. `$`, `PS>` and a `# pwsh` first line all put
// characters on the page that are not part of the command, and every one of them
// has to be edited out after a paste. MDN's guidance is the same. Where a
// document genuinely mixes shells, say so in the prose around the block.
//
// breakable is opt-in. A command split across a page turn is a command with no
// second half, so the default refuses to break; a long listing that legitimately
// spans pages passes `breakable: true` through a closure:
//
//   #show raw.where(block: true): it => code(it, breakable: true)
#let code(body, breakable: false) = block(
  width: 100%, fill: paper-tint, stroke: 0.6pt + rule-mid,
  inset: (x: 7pt, y: 6pt), radius: 1.5pt, breakable: breakable,
  body,
)

// Links that work on a screen and on paper, in the one PDF. A document installs it, as it
// installs `code`:
//
//   #show link: link-note
//
// The text is coloured AND underlined, so it still reads as a link from a greyscale printer,
// and it still clicks. Where the page would hide the address, it goes in a footnote, as books
// print it: unobtrusive on a screen, and on paper the reader can still type it. The scheme
// (https://, http://, mailto:) and a trailing slash are left off, since a browser supplies
// them. No footnote when the text already is the address, or when the link goes to a place
// in the same document.
//
// Keep links out of headings once a document has an outline: the contents repeat the
// heading, and its footnote with it, so the address is noted twice.
#let link-note(it) = {
  let shown = underline(stroke: 0.5pt + slate, offset: 1.6pt, text(fill: slate, it))
  if type(it.dest) != str { return shown }
  let address = it.dest
  for prefix in ("mailto:", "https://", "http://") {
    address = address.trim(prefix, at: start, repeat: false)
  }
  address = address.trim("/", at: end, repeat: false)
  let body = if it.body.has("text") { it.body.text.trim("/", at: end, repeat: false) }
  if body in (it.dest.trim("/", at: end, repeat: false), address) { shown } else {
    shown + footnote(address)
  }
}

// Numbered entry: marker, title, explanation.
#let item(n, title, body, color: slate, size: sz.small) = block(
  width: 100%, breakable: false, inset: (bottom: 6pt),
)[
  #text(size: size, weight: 700, fill: color)[#n]
  #h(5pt)
  #text(size: size, weight: 700)[#title]
  #v(2pt)
  #text(size: size)[#body]
]

// Hairline table with a tinted header row. The header goes through `table.header`, so the
// PDF marks it as one and a screen reader reads it as the column labels, not as data.
#let matrix(head, ..rows) = table(
  columns: (auto, 1fr),
  stroke: 0.4pt + rule-hair,
  inset: (x: 7pt, y: 5.5pt),
  fill: (_, y) => if y == 0 { slate-tint } else { none },
  table.header(..head.map(h => text(size: sz.fine, weight: 700)[#h])),
  ..rows.pos().map(c => text(size: sz.fine)[#c]),
)

// a → b → c, for pipelines.
#let flow(..steps) = align(center)[
  #box(inset: (x: 9pt, y: 6pt), stroke: 0.6pt + rule-mid, radius: 1pt)[
    #text(size: sz.small)[
      #steps.pos().join([ #text(fill: ink-faint)[#sym.arrow.r] ])
    ]
  ]
]

#let stamp(body) = {
  v(4pt)
  line(length: 100%, stroke: 0.5pt + rule-hair)
  v(2pt)
  text(size: sz.micro, fill: ink-faint, style: "italic")[#body]
}


// When the page's content last changed, as tools/stamp.sh stamps it.
// A rebuild that changes nothing on the page keeps the old time, so a newer time than the
// copy on the shelf means reprint, and the same time means that copy is current. Put it in
// the footer, where every page carries it: a page parted from its stack still says which
// edition it is. Built without tools/stamp.sh -- typst watch, a bare typst compile -- there is
// no stamp, and it says so rather than inventing one.
#let updated() = {
  let s = sys.inputs.at("press-updated", default: none)
  if s == none { [not stamped (built without press's stamp.sh)] } else { [updated #s] }
}

// The version of press a document was set with, read from press.toml beside this file, so a
// page that prints it always names the press it was built with. Not `version`: that is
// typst's own, and `import *` would shadow it.
#let press-version = _manifest.version

// What the document did not set: a scanned form, an embedded PDF page, placed as it is. The
// audit leaves it out. check compiles the document a second time with every scan hidden, its
// space kept, and reads that copy for fonts, text on text and ink near the edge: a scan's own
// fonts, text layer and full-bleed ink are not findings, and whatever the document sets over
// it is audited as usual.
//
//   #place(top + left, scan(image("form.pdf", width: 100%, height: 100%)))
#let scan(body) = if sys.inputs.at("press-scans", default: none) == "hidden" { hide(body) } else { body }

// ----------------------------------------------------------- composition ---
// Generic by nature — a labelled bounded block, a state chip, a reversed band, a numbered
// badge.

// The workhorse. A bounded unit of exactly one idea: a label to navigate by, a
// bold LEAD that is the highlight pre-made, and a body as long as the idea
// actually needs. There is no length cap on purpose — capping length lets the
// format decide what the reader is allowed to know.
// `caps` forwards to the label's `eyebrow` — see the note there. This is the
// most-used call in the vocabulary, so it is where the uppercasing does the most
// damage: `unit([pH], "warn")` renders "PH" with nothing to indicate it happened.
#let unit(label, tone, lead, body, caps: true, breakable: false) = {
  let pair = tones.at(tone)
  block(width: 100%, breakable: breakable, stroke: (left: 2.5pt + pair.at(0)),
        fill: paper-tint, inset: (x: 8pt, y: 6.5pt))[
    #eyebrow(label, color: pair.at(0), caps: caps)
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

// Reversed section band. `role` rides inside it — decide / design / reference —
// so that skipping a section is a deliberate act rather than an accident.
// `caps` as on `eyebrow` — see the note there. A band titled "pH and conductivity"
// silently becomes "PH AND CONDUCTIVITY" without it.
#let band-strong(title, role, color: slate, caps: true) = {
  v(2pt)
  block(width: 100%, fill: color, inset: (x: 8pt, y: 4.5pt), radius: 1pt)[
    #grid(columns: (1fr, auto), align: (left + horizon, right + horizon),
      text(size: sz.fine, weight: 700, tracking: 1.2pt, fill: white)[#if caps { upper(title) } else { title }],
      text(size: sz.micro, fill: white.darken(12%), style: "italic")[#role])
  ]
  v(5pt)
}

#let dbadge(n, color: bad) = box(
  fill: color, radius: 50%, inset: (x: 4.5pt, y: 3pt),
  text(size: sz.fine, weight: 700, fill: white)[#n],
)

// A badged question with its note — for anything the reader must answer.
#let decision(n, q, note, color: bad) = block(
  width: 100%, breakable: false, inset: (bottom: 5.5pt),
)[
  #grid(columns: (auto, 1fr), gutter: 6pt, align: (left + top, left + top),
    dbadge(n, color: color),
    [
      #text(size: sz.fine, weight: 700)[#q]
      #v(1.5pt)
      #text(size: sz.fine, fill: ink-soft)[#note]
    ])
]

// A wide data table, for more columns than `matrix`'s two. Promoted after the same helper
// turned up, byte-identical, in five documents.
//
// `cols` is passed through to `table.columns` so the document keeps control of
// widths. Header row is bold on a slate tint, body rows zebra-striped.
//
// `size` exists because a fixed size pushed documents into writing their own per-cell
// wrapper just to get a different one.
//
// The header goes through `table.header`, which repeats it on every page the table
// spans. Without it a table crossing a page break leaves the reader with bare rows
// and no column labels — and on paper there is no scrolling back. `matrix` gets away
// without it because two-column comparisons are short; `sheet` is explicitly the
// many-column data table, which is the shape that breaks.
#let sheet(cols, head, size: sz.micro, ..rows) = table(
  columns: cols,
  stroke: 0.4pt + rule-hair,
  inset: (x: 5pt, y: 4pt),
  fill: (_, y) => if y == 0 { slate-tint } else if calc.odd(y) { paper-tint } else { none },
  table.header(..head.map(h => text(size: size, weight: 700)[#h])),
  ..rows.pos().map(c => text(size: size)[#c]),
)

// Pointer from the act layer to the depth layer, without a page number typed by hand:
//
//   #seedepth[quarter figures]                    -> detail: quarter figures
//   #seedepth(<quarter>)                          -> detail on p. 2
//   #seedepth(at: <quarter>)[quarter figures]     -> detail: quarter figures, p. 2
//
// Given a label, the page is looked up where the label lands, so it stays right when the
// layout moves, and it links there: on a screen it clicks through, on paper it is a page
// number. A label that does not exist is a compile error, not a silent "p. ?".
#let seedepth(what, at: none) = {
  let target = if type(what) == label { what } else { at }
  let on = if target != none {
    link(target, context [p. #counter(page).at(locate(target)).first()])
  }
  text(size: sz.fine, fill: ink-faint, style: "italic")[
    #sym.arrow.r #if type(what) == label [detail on #on] else if on == none [detail: #what] else [detail: #what, #on]
  ]
}


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

// --------------------------------------------------------------- letters ---
// A letter's own parts, which template/letter.typ composes and a letter takes as it needs.
// The writer is the document's author, set once with `set document(author: "…")`, and the date
// is written once, with dateline(), where the letter prints it; no part takes either again. The
// date is never the build stamp: a letter is dated the day it goes out, and its reader is
// outside, with no shelf copy to compare.

#let _letter-date = state("press-letter-date", none)

// The writer's name, from the document's author. Called in context.
#let _writer() = {
  assert(document.author.len() > 0,
    message: "a letter takes its writer from set document(author: \"…\"); set it once at the top")
  document.author.join(", ")
}

// The writer's name, a line of contact details, and a rule beneath. A contact item is text or
// a link; a link that shows its own address (link("mailto:…"), or link(url)[example.com])
// reads the same on paper as on screen, so link-note adds no footnote to it. `face` sets a
// letter in the face of the résumé it goes with, and align(center, letterhead(…)) centres the
// name and contact line to match a résumé's centred header; the rule stays full width.
#let letterhead(..contact, face: face-text) = block(width: 100%, above: 0pt, below: 22pt, context {
  set text(font: face)
  let items = contact.pos()
  stack(spacing: 7pt,
    text(size: sz.head, weight: 700, fill: ink, _writer()),
    ..if items.len() > 0 {
      (text(size: sz.small, fill: ink-soft, items.join(text(fill: ink-faint)[ #sym.dot.c ])),)
    },
    line(length: 100%, stroke: 0.75pt + rule-mid),
  )
})

// The letter's date, written once, where it prints. continued() reads it from here.
#let dateline(date) = { _letter-date.update(date); date }

// The subject line. Each reference is kept whole, so an account number never breaks across a
// line, and stays text a reader can copy.
#let re(..refs, label: [Re:]) = block(above: 1.2em, below: 1.2em,
  [#text(weight: 700, label) #refs.pos().map(r => box(r)).join([; ])])

// Where the letter is signed, with its closing (`closing: [Sincerely,]`) kept on the same page,
// so a page break never strands it. By default, space for an ink signature over a line with the
// writer's name beneath, and beside it a line to date by hand (`dated: false` leaves that out).
// For a letter sent as a file, `signed: false` is a typed sign-off: the name alone.
#let signature(closing: none, signed: true, dated: true) = block(breakable: false, context {
  let name = _writer()
  if closing != none { closing }
  if not signed {
    if closing != none { parbreak() }
    name
  } else {
    let slot(caption) = stack(spacing: 5pt, line(length: 100%, stroke: 0.5pt + ink), caption)
    v(0.55in)
    grid(columns: if dated { (2.6in, 0.4in, 1.4in) } else { (2.6in,) },
      slot(name), ..if dated { ([], slot([Date])) } else { () })
  }
})

// What goes with the letter, one item to a line.
#let enclosures(..items) = {
  let items = items.pos()
  assert(items.len() > 0, message: "enclosures() needs at least one item")
  block(above: 2em, breakable: false, {
    text(weight: 700, if items.len() == 1 [Enclosure] else [Enclosures])
    pad(left: 1.2em, top: 2pt, items.join(linebreak()))
  })
}

// A header for page two onward: the writer, the date and the page number, so a page parted
// from the first still says whose letter it is. Page one is left to the letterhead.
//
//   #set page(..reading, header: continued())
#let continued() = context {
  let n = counter(page).get().first()
  if n > 1 {
    set text(size: sz.fine, fill: ink-soft)
    let date = _letter-date.final()
    grid(columns: (1fr, auto, 1fr), align: (left, center, right),
      _writer(), if date != none { date }, [Page #n])
  }
}

// ------------------------------------------------------------- templates ---
// press's templates: a document's page, type and head, composed from the parts above, which a
// document applies with a show rule and nothing else. Each is press's universal default for a
// kind of document. A repository imports one as it is, or copies it and changes its copy; press
// says nothing about which. They stay generic: what one repository alone needs belongs in its
// own copy, and press adds another template when enough documents need one.

// The general-purpose document: a sheet, a guide, a brief. The title names the document once,
// in the PDF's metadata and in the head, and the footer prints it beside the status, the
// stamp and the page. `meta` sits at the right of the head; `legend` is the colour legend
// under it (auto, the three states press's chips carry; none; or content of your own).
// `preset` is the page.
//
//   #show: brief.with(title: [Rack power], author: "Your name", meta: [Site A · October 2026])
#let brief(
  title: none, author: (), meta: none, status: none, legend: auto, preset: card, body,
) = {
  set document(title: title, author: author)
  set page(..preset, footer: context {
    set text(size: sz.micro, fill: ink-faint)
    grid(columns: (1fr, auto),
      align(left)[#document.title#if status != none [ · #status]],
      align(right)[#updated() · #counter(page).display("1 / 1", both: true)])
  })
  set text(font: face-text, size: sz.small, fill: ink, lang: "en")
  set par(leading: 0.52em, spacing: 0.55em)
  set list(indent: 0.65em, body-indent: 0.34em, spacing: 0.32em)
  show raw: set text(font: face-mono, size: sz.micro)
  show raw.where(block: true): code
  show link: link-note

  grid(columns: (auto, 1fr), align: (left + bottom, right + bottom),
    text(font: face-display, size: sz.title, weight: 700, title),
    text(size: sz.fine, fill: ink-soft, meta))
  v(-3pt)
  line(length: 100%, stroke: 2pt + slate)
  v(4pt)
  if legend == auto {
    grid(columns: (auto, 1fr), align: (left + horizon, right + horizon),
      text(size: sz.micro, fill: ink-faint)[Colour is state. Bands carry a role — skip on purpose.],
      align(right)[#chip([SETTLED], "ok") #h(3pt) #chip([CONDITIONAL], "warn") #h(3pt) #chip([DECIDE], "bad")])
    v(7pt)
  } else if legend != none {
    legend
    v(7pt)
  }
  body
}

// A letter: the reading page, the letterhead, and the date once; page two onward carries
// continued()'s header. The body is the letter from the recipient on, ending with signature()
// and, where it has them, enclosures(). `face` sets the letter, letterhead included, in the
// face of a résumé it goes with, and `centred` centres the letterhead to match a centred head.
//
//   #show: letter.with(title: [Letter to the county], author: "Your Name",
//     contact: ([Town, ST], link("mailto:you@example.com")), date: [15 October 2026])
#let letter(
  title: none, author: (), contact: (), date: none, face: face-text, centred: false, body,
) = {
  set document(title: title, author: author)
  set page(..reading, header: continued())
  set text(font: face, size: sz.body, fill: ink, lang: "en")
  set par(leading: 0.6em, spacing: 1.05em)
  show link: link-note

  let head = letterhead(..contact, face: face)
  if centred { align(center, head) } else { head }
  if date != none { dateline(date); parbreak() }
  body
}
