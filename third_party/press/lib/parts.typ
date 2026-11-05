// press's parts: the pieces a page is made of, each one thing, which documents and templates
// compose.

#import "tokens.typ": *

// `caps` is opt-out because upper() CORRUPTS case-carrying strings, and silently:
// "pH" becomes "PH", "iOS" becomes "IOS", and "µS" becomes "ΜS" — micro-sign
// turned into capital Mu, a different character entirely. Pass `caps: false`
// whenever the case of the label means something.
#let eyebrow(body, color: slate, caps: true, size: sz.fine) = text(
  size: size, weight: 700, tracking: 1.2pt, fill: color,
  if caps { upper(body) } else { body },
)

// A section whose headings show its state: inside it, a template's `=` band and `==` label take
// `color`, any colour, where every other heading stays slate. Where it is ok, warn or bad, they
// draw that state's shape too, as a chip does, so the state reads on a grey printout. Wrap the
// one heading or the whole section. A label on the heading, `<depth>` among them, stays where it
// is; a section inside another takes its own colour; `#show: section.with(color: steel)` colours
// a whole document's.
//
//   #section(color: bad)[= Red-flag signs]
#let _section-colors = state("press-section-colors", ())
#let section(body, color: slate) = {
  _section-colors.update(s => s + (color,))
  body
  _section-colors.update(s => s.slice(0, -1))
}
// The colour of a heading where it stands, which a template's heading rules read in context.
#let _section-color() = _section-colors.get().at(-1, default: slate)

// The gap between a part's pieces: its label, title or lead and its body. Each part sets it for
// itself, so a part keeps the layout it was drawn for whatever gap a template sets between a
// document's paragraphs; the body's own paragraphs and lists keep the document's, as _body sets.
#let _part-gap = 0.55em

// A part's body, its paragraphs and lists spaced as the document spaces them: `spacing` is the
// document's paragraph spacing, read before the part sets its own. The part's own gap stays around
// the body, so a body of one paragraph sits as it did, and the part's other pieces with it.
#let _body(spacing, body) = block(spacing: _part-gap, { set par(spacing: spacing); body })

// press's marks in a title, unsourced()'s, and the title without them. footer() prints the title
// on every page, and a mark printed with it each time would count one item once a page.
#let _is-mark(it) = (type(it) == content and it.func() == metadata and type(it.value) == str
  and it.value.starts-with("press-"))
#let _marks(it) = {
  if type(it) != content { () } else if _is-mark(it) { (it,) }
  else if it.has("children") { it.children.map(_marks).flatten() } else { () }
}
#let _unmarked(it) = {
  if type(it) != content { it } else if _is-mark(it) { none }
  else if it.has("children") { it.children.map(_unmarked).join() } else { it }
}

// A title marked with unsourced() is counted once, wherever it prints, and where it prints
// nowhere, as a letter's: typst's title() with the document's own title counts it, printing it;
// else header(); else the footer() on the first page that has one; else the start of the
// document, which every template marks. The others print it without its marks.
#let _titled() = query(title).any(t => t.body == auto or t.body == document.title)

// The start of a template's document, where the title is counted when nothing prints it.
#let _title-start() = context if (not _titled() and query(<press-header>).len() == 0
  and query(<press-footer>).len() == 0) {
  _marks(document.title).join()
}

// A document's header: its title on the left, `meta` on the right, and a rule beneath. The title
// is the one the document names itself with, set document(title:) or a template's title, so it
// is named once, as footer() names it.
//
//   #header(meta: [Site A · October 2026])
#let header(meta: none, color: slate, face: face-display, size: sz.title) = context block(width: 100%, {
  // Its rule sits under the title by the part's own gap, whatever a template sets between
  // paragraphs.
  set par(spacing: _part-gap)
  // Tells footer() and the document's start the title's marks are counted here.
  [#metadata(none)<press-header>]
  if not _titled() { _marks(document.title).join() }
  grid(
    columns: (auto, 1fr),
    align: (left + bottom, right + bottom),
    text(font: face, size: size, weight: 700, fill: ink, _unmarked(document.title)),
    text(size: sz.fine, fill: ink-soft, meta),
  )
  v(-3pt)
  line(length: 100%, stroke: 2pt + color)
})

#let tones = (
  note: (slate, slate-tint), ok: (ok, ok-tint),
  warn: (warn, warn-tint), bad: (bad, bad-tint),
)

// The shape each tone draws beside a state, so the state reads without its colour. Printed in
// grey, ok and warn come out nearly the same, about 96 and 102 of 255 in Rec. 601 luma, and on
// paper colour alone carries nothing that a monochrome printer or a reader's eyes may lose.
#let _tone-shapes = (note: "diamond", ok: "circle", warn: "triangle", bad: "square")

// The shape a template's headings draw where the section's colour is a state's, ok, warn or bad,
// and none for any other: slate is every heading's colour, so note's diamond would mark them all.
#let _section-shape() = {
  let c = _section-color()
  let tone = tones.keys().find(t => t != "note" and tones.at(t).at(0) == c)
  if tone == none { none } else { _tone-shapes.at(tone) }
}

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

// A state's shape and a space, set before a part's label in the tone's colour: the tone's own
// shape where `shape` is auto, another of the four by name, or nothing where it is none.
#let _shaped(part, tone, shape, gap: 0.35em) = {
  let shape = if shape == auto { _tone-shapes.at(tone) } else { shape }
  assert(shape == none or shape in _tone-shapes.values(),
    message: part + "(shape:) expects \"circle\", \"triangle\", \"square\", \"diamond\" or "
      + "none; got " + repr(shape))
  if shape != none [#_shape(shape, tones.at(tone).at(0))#h(gap)]
}

// Tinted callout with a weighted left edge. Its label is kept with the body under it, so a page
// never ends on the label alone. The label's block is set at the label's own size, as a line of
// it would be, so the space under it is measured in that size and not the callout's. Its tone's
// shape goes before its label, or before its body where it has none, so its state reads on a
// grey printout as a chip's does; `shape` changes it, as chip(shape:) does. `caps: false` keeps
// its label's case.
#let callout(body, tone: "note", label: none, size: sz.small, shape: auto, caps: true) = {
  let pair = tones.at(tone)
  let mark = _shaped("callout", tone, shape)
  context block(
    width: 100%, fill: pair.at(1), stroke: (left: 3pt + pair.at(0)),
    inset: (x: 10pt, y: 8pt),
  )[
    #let spacing = par.spacing
    #set par(spacing: _part-gap)
    #if label != none [#text(size: sz.fine, block(sticky: true,
      [#mark#eyebrow(label, color: pair.at(0), caps: caps)])) #v(3pt)]
    #text(size: size, _body(spacing, [#if label == none { mark }#body]))
  ]
}

// Bordered panel — for grids where a tint would shout. Its label is kept with the body, as a
// callout's is, and `caps: false` keeps its case.
#let panel(body, label: none, color: slate, caps: true) = context block(
  width: 100%, stroke: 0.6pt + rule-mid, inset: 10pt, radius: 1pt,
)[
  #let spacing = par.spacing
  #set par(spacing: _part-gap)
  #if label != none [#text(size: sz.fine, block(sticky: true, eyebrow(label, color: color, caps: caps))) #v(4pt)]
  #_body(spacing, body)
]

// Code block treatment. Every template installs it, and a document without one installs it:
//
//   #show raw: set text(font: face-mono, size: sz.fine / sz.small / 0.8 * 1em)
//   #show raw.where(block: true): code
//
// The first sets code a step below the text around it, sz.fine in body text: typst's own rule
// for raw sets it at 0.8em, and an em in a rule for raw is that 0.8em.
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
//
// A template installs code for every block, so a document's own rule for one block, above,
// runs first and code then meets the same block again. It marks what it holds, and leaves a
// block already inside a code alone: the document's choice stands, and the block is boxed once.
#let _in-code = state("press-in-code", false)
#let code(body, breakable: false) = context if _in-code.get() { body } else {
  block(
    width: 100%, fill: paper-tint, stroke: 0.6pt + rule-mid,
    inset: (x: 7pt, y: 6pt), radius: 1.5pt, breakable: breakable,
    { _in-code.update(true); body; _in-code.update(false) },
  )
}

// Links that work on a screen and on paper, in the one PDF. Every template installs it, as it
// installs `code`, and a document without one installs it:
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
#let item(n, title, body, color: slate, size: sz.small) = context block(
  width: 100%, breakable: false, inset: (bottom: 6pt),
)[
  #let spacing = par.spacing
  #set par(spacing: _part-gap)
  #text(size: size, weight: 700, fill: color)[#n]
  #h(5pt)
  #text(size: size, weight: 700)[#title]
  #v(2pt)
  #text(size: size, _body(spacing, body))
]

// a → b → c, for pipelines.
#let flow(..steps) = align(center)[
  #box(inset: (x: 9pt, y: 6pt), stroke: 0.6pt + rule-mid, radius: 1pt)[
    #text(size: sz.small)[
      #steps.pos().join([ #text(fill: ink-faint)[#sym.arrow.r] ])
    ]
  ]
]

#let stamp(body) = {
  // The hairline is a sticky block, which typst keeps with the words after it, so a page never
  // ends on the rule alone. The gap under it is the part's own, as inside every other part.
  block(sticky: true, below: _part-gap, {
    v(4pt)
    line(length: 100%, stroke: 0.5pt + rule-hair)
    v(2pt)
  })
  text(size: sz.micro, fill: ink-faint, style: "italic")[#body]
}

// A note set under an entry later, beside what it amends rather than over it: a revisit, a
// retelling, a correction to a record that keeps what was first written. Its label and date stay
// on the page with its body, so a page never ends on them alone. `label` says what kind of note
// it is, `color` draws its edge and label, and `caps: false` keeps its case. Its label is
// sz.fine, or the size of the text around it where that is smaller, as in a sheet's cell, so it
// never outweighs the entry it is under.
//
//   #addendum([2026-10-15 21:11], label: [Retold])[What was told the second time.]
#let addendum(date, body, label: [Later], color: ink-faint, caps: true) = context block(
  width: 100%, above: 0.9em, inset: (left: 0.8em), stroke: (left: 0.6pt + color),
)[
  #let spacing = par.spacing
  #set par(spacing: _part-gap)
  #block(sticky: true, below: 0.75em, context eyebrow([#label · #date], color: color, caps: caps,
    size: calc.min(sz.fine, text.size)))
  #text(fill: ink-soft, _body(spacing, body))
]


// A part's own words, as a document passes them in `words`: every key the part prints must be
// there, so a misspelt or missing one is a compile error naming it, not English left behind.
#let _words(part, words, ..keys) = {
  let keys = keys.pos()
  for k in keys {
    assert(type(words) == dictionary and k in words,
      message: part + "(words:) takes " + keys.map(k => k + ":").join(", ") + "; " + k + ": is missing")
  }
  words
}

// A value the document prints without having read it from a source, marked by its `kind`, so that
// on paper it never reads like the values around it that were:
//
//   "open"      what only the document's owner can supply, left to fill in: an account number, a
//               figure, a date. Red and bold, so it cannot go out unnoticed.
//   "missing"   what the document does not have and no one will supply, printed where it would
//               stand, since a blank there reads as none. Faint and italic, apart from the values
//               around it.
//   "estimate"  a figure printed but guessed: a price estimated for a category, a size judged by
//               eye. The figure, then a word that says so, both in amber and bold: the colour is
//               lost on a grey printout, and the word is not.
//
// The kind is what the audit reads. It says how many open items remain ("2 open items") and how
// many estimates a document prints, and fails for neither, since a draft carries them; a missing
// value it leaves alone, as nothing is left to do. How each kind looks is only its default:
// `color`, `weight` and `style` change it, and `words` the word an estimate prints.
//
//   Account #unsourced[number from the statement].
//   Milkings per day: #unsourced(kind: "missing")[not recorded].
//   Feed, per bag: #unsourced(kind: "estimate")[\$18.00].
//
// A document that marks one kind often names it once:
//
//   #let est = unsourced.with(kind: "estimate")
#let _unsourced = (
  open: (fill: bad, weight: 700),
  missing: (fill: ink-faint, style: "italic"),
  estimate: (fill: warn, weight: 700),
)
#let unsourced(
  body, kind: "open", color: auto, weight: auto, style: auto, words: (estimate: [estimate]),
) = {
  // An unknown kind fails rather than falling through to one that looks deliberate.
  assert(type(kind) == str and kind in _unsourced,
    message: "unsourced(kind:) expects \"open\", \"missing\" or \"estimate\"; got " + repr(kind))
  let word = _words("unsourced", words, "estimate").estimate
  let look = _unsourced.at(kind)
  for (key, value) in (fill: color, weight: weight, style: style) {
    if value != auto { look.insert(key, value) }
  }
  [#metadata("press-" + kind)#text(..look, if kind == "estimate" [#body #word] else { body })]
}

// A number with its whole part grouped by thousands, from four digits, so a figure read at a
// glance is not misread: 3465 prints 3,465, and decimal("1234567.50") prints 1,234,567.50. Its
// decimals stay as typst prints them, and so does its sign, typst's minus. It takes an int, a
// float or a decimal; a figure read from data as text is converted first, `num(int(row.cows))`.
// A sum of money is a decimal, `num(decimal(row.amount))`: typst prints a float in its shortest
// form, so 12480.50 read as a float prints 12,480.5, and a sum of floats can print
// 0.30000000000000004, where a decimal keeps its places through arithmetic. In TOML or JSON,
// where a number with cents is a float, write the sum as a string. `words: (thousands: [ ])`
// groups it with a space instead.
//
//   #sheet((1fr, auto), ([Dairy], [Cows]), [North], num(3465), [South], num(12480))
#let num(n, words: (thousands: [,])) = {
  assert(type(n) in (int, float, decimal),
    message: "num() takes an int, a float or a decimal; got " + repr(n))
  let sep = _words("num", words, "thousands").thousands
  let s = str(n)
  let sign = if s.starts-with("\u{2212}") { "\u{2212}" } else { "" }
  let (whole, ..decimals) = s.slice(sign.len()).split(".")
  assert(whole.match(regex("^[0-9]+$")) != none,
    message: "num() groups the digits typst prints, and it prints " + s)
  let digits = whole.clusters()
  let groups = ()
  let end = digits.len()
  while end > 0 {
    groups.insert(0, digits.slice(calc.max(0, end - 3), end).join())
    end -= 3
  }
  [#sign#groups.join(sep)#if decimals.len() > 0 [.#decimals.join()]]
}

// When the page's content last changed, as tools/stamp.sh stamps it.
// A rebuild that changes nothing on the page keeps the old time, so a newer time than the
// copy on the shelf means reprint, and the same time means that copy is current. Put it in
// the footer, where every page carries it: a page parted from its stack still says which
// edition it is. Built without tools/stamp.sh -- typst watch, a bare typst compile -- there is
// no stamp, and it says so rather than inventing one.
#let updated(words: (updated: [updated], unstamped: [not stamped (built without press's stamp.sh)])) = {
  let w = _words("updated", words, "updated", "unstamped")
  let s = sys.inputs.at("press-updated", default: none)
  if s == none { w.unstamped } else { [#w.updated #s] }
}

// A page's footer, so a page parted from the rest still says what it is and which edition: the
// document's title, and its status where it has one, on the left; updated() and the page of the
// total on the right. The title is the one the document names itself with, set document(title:)
// or a template's title, as header() names it. `edition` is what it says of the edition: none
// leaves it out, and updated(words: …) says it in other words. A title marked with unsourced()
// counts once: typst's title() with the document's own title counts it, or header(), or with
// neither, the footer on the first page that has one.
//
//   #set page(..dense, footer: footer(status: [draft]))
#let footer(status: none, edition: updated()) = context {
  set text(size: sz.micro, fill: ink-faint)
  // Tells the document's start, and the footers after this one, the title's marks are counted.
  [#metadata(none)<press-footer>]
  let footers = query(<press-footer>)
  if (footers.len() > 0 and footers.first().location().page() == here().page()
      and query(<press-header>).len() == 0 and not _titled()) {
    _marks(document.title).join()
  }
  grid(columns: (1fr, auto),
    align(left)[#_unmarked(document.title)#if status != none [ · #status]],
    align(right)[#if edition != none [#edition · ]#counter(page).display("1 / 1", both: true)])
}


// What the document did not set: a scanned form, an embedded PDF page, placed as it is. The
// audit leaves it out. check compiles the document a second time with every scan hidden, its
// space kept, and reads that copy for fonts, text on text and ink near the edge: a scan's own
// fonts, text layer and full-bleed ink are not findings, and whatever the document sets over
// it is audited as usual.
//
//   #place(top + left, scan(image("form.pdf", width: 100%, height: 100%)))
#let scan(body) = if sys.inputs.at("press-scans", default: none) == "hidden" { hide(body) } else { body }


// The measuring grid form(probe:) draws over its page, for reading where each blank is: a line
// every step, every fourth one heavier, and where two heavy lines cross, that point's x and y in
// points, as place() takes them. In the blue a layout guide is drawn in, over the blank and the
// answers both, so an answer can be checked against its blank. It is a scan(), so the audit
// leaves it out, and the audit fails while it is on.
#let _probe(step) = place(top + left, layout(size => {
  let step = step.to-absolute()
  assert(step > 0pt, message: "form(probe:) takes a step greater than zero: probe: 18pt")
  let guide = rgb("#4aa8d8")
  let (nx, ny) = (int(size.width / step), int(size.height / step))
  for i in range(nx + 1) {
    place(top + left, dx: i * step, line(angle: 90deg, length: size.height,
      stroke: if calc.rem(i, 4) == 0 { 0.6pt + guide } else { 0.3pt + guide.transparentize(50%) }))
  }
  for j in range(ny + 1) {
    place(top + left, dy: j * step, line(length: size.width,
      stroke: if calc.rem(j, 4) == 0 { 0.6pt + guide } else { 0.3pt + guide.transparentize(50%) }))
  }
  let pt(v) = str(calc.round(v.pt(), digits: 2))
  for i in range(0, nx + 1, step: 4) {
    for j in range(0, ny + 1, step: 4) {
      place(top + left, dx: i * step + 1pt, dy: j * step + 1pt,
        text(font: face-mono, size: 5pt, fill: guide.darken(40%), [#pt(i * step), #pt(j * step)]))
    }
  }
}))

// FILLING IN A FORM: a flat PDF form, or a scan of one, its blanks filled in. Each page of it is
// a form(): the blank's own page, its size and edge to edge whatever the document's preset, with
// none of the document's header, footer, background or foreground, since with no margin a header
// and a footer still print, at the paper's edges. The blank is a scan() and the answers go over
// it. An answer is typst's own place(dx:, dy:), measured from the page's top-left corner as a
// ruler would: the point is the answer's own top-left, where its capitals begin, so the text
// hangs below it, and an answer meant to stand on a blank's line goes above the line by its
// capitals' height, about seven tenths of its text size. In a box with a width, a long answer
// wraps inside it. tick() marks a box, centred on the point given. The document makes the image,
// so its path is the document's own: a path handed to a part of press's is read from press's
// folder. Given probe: and a step, form() draws a measuring grid over its page for reading where
// each blank is, and the audit fails while it is on.
//
//   #form(image("application.pdf", page: 2))[
//     #place(dx: 72pt, dy: 144pt)[Jane Doe]
//     #place(dx: 380pt, dy: 144pt, box(width: 120pt)[an answer longer than its blank])
//     #tick(96pt, 210pt)
//   ]
#let form(blank, probe: none, body) = {
  assert(probe == none or type(probe) == length,
    message: "form(probe:) takes none, its default, or the grid's step as a length: probe: 18pt")
  std.page(width: auto, height: auto, margin: 0pt,
    header: none, footer: none, background: none,
    foreground: if probe != none { scan(_probe(probe)) },
    { block(scan(blank)); place(top + left, body); if probe != none { metadata("press-probe") } })
}

#let tick(x, y) = place(top + left, dx: x, dy: y,
  place(center + horizon, text(weight: 700, top-edge: "cap-height", bottom-edge: "baseline")[X]))


// The writer's name, from the document's author. Called in context; `what` names the document
// that needs it, for the message when no author is set.
#let _writer(what: "a letter") = {
  assert(document.author.len() > 0,
    message: what + " takes its writer from set document(author: \"…\"); set it once at the top")
  document.author.join(", ")
}
