// press's parts: the pieces a page is made of, each one thing, which documents and templates
// compose.

#import "tokens.typ": *

// ----------------------------------------------------------------- parts ---

// `caps` is opt-out because upper() CORRUPTS case-carrying strings, and silently:
// "pH" becomes "PH", "iOS" becomes "IOS", and "µS" becomes "ΜS" — micro-sign
// turned into capital Mu, a different character entirely. Pass `caps: false`
// whenever the case of the label means something.
#let eyebrow(body, color: slate, caps: true) = text(
  size: sz.fine, weight: 700, tracking: 1.2pt, fill: color,
  if caps { upper(body) } else { body },
)

// A section whose headings show its state: inside it, a template's `=` band and `==` label take
// `color`, any colour, where every other heading stays slate. Wrap the one heading or the whole
// section. A label on the heading, `<depth>` among them, stays where it is; a section inside
// another takes its own colour; `#show: section.with(color: steel)` colours a whole document's.
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

// A document's header: its title on the left, `meta` on the right, and a rule beneath. The title
// is the one the document names itself with, set document(title:) or a template's title, so it
// is named once, as footer() names it.
//
//   #header(meta: [Site A · October 2026])
#let header(meta: none, color: slate, face: face-display, size: sz.title) = context {
  grid(
    columns: (auto, 1fr),
    align: (left + bottom, right + bottom),
    text(font: face, size: size, weight: 700, fill: ink, document.title),
    text(size: sz.fine, fill: ink-soft, meta),
  )
  v(-3pt)
  line(length: 100%, stroke: 2pt + color)
}

#let tones = (
  note: (slate, slate-tint), ok: (ok, ok-tint),
  warn: (warn, warn-tint), bad: (bad, bad-tint),
)

// Tinted callout with a weighted left edge. Its label is kept with the body under it, so a page
// never ends on the label alone. The label's block is set at the label's own size, as a line of
// it would be, so the space under it is measured in that size and not the callout's.
#let callout(body, tone: "note", label: none, size: sz.small) = {
  let pair = tones.at(tone)
  block(
    width: 100%, fill: pair.at(1), stroke: (left: 3pt + pair.at(0)),
    inset: (x: 10pt, y: 8pt),
  )[
    #if label != none [#text(size: sz.fine, block(sticky: true, eyebrow(label, color: pair.at(0)))) #v(3pt)]
    #text(size: size)[#body]
  ]
}

// Bordered panel — for grids where a tint would shout. Its label is kept with the body, as a
// callout's is.
#let panel(body, label: none, color: slate) = block(
  width: 100%, stroke: 0.6pt + rule-mid, inset: 10pt, radius: 1pt,
)[
  #if label != none [#text(size: sz.fine, block(sticky: true, eyebrow(label, color: color))) #v(4pt)]
  #body
]

// Code block treatment. The document installs it; press never does:
//
//   #show raw: set text(font: face-mono, size: sz.fine)
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

// A note set under an entry later, beside what it amends rather than over it: a revisit, a
// retelling, a correction to a record that keeps what was first written. Its label and date stay
// on the page with its body, so a page never ends on them alone. `label` says what kind of note
// it is, `color` draws its edge and label, and `caps: false` keeps its case.
//
//   #addendum([2026-10-15 21:11], label: [Retold])[What was told the second time.]
#let addendum(date, body, label: [Later], color: ink-faint, caps: true) = block(
  width: 100%, above: 0.9em, inset: (left: 0.8em), stroke: (left: 0.6pt + color),
)[
  #block(sticky: true, below: 0.75em, eyebrow([#label · #date], color: color, caps: caps))
  #text(fill: ink-soft, body)
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
// leaves it out, and updated(words: …) says it in other words.
//
//   #set page(..dense, footer: footer(status: [draft]))
#let footer(status: none, edition: updated()) = context {
  set text(size: sz.micro, fill: ink-faint)
  grid(columns: (1fr, auto),
    align(left)[#document.title#if status != none [ · #status]],
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
