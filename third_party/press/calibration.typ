// Print calibration sheet for the press token set.
//
// Print this TWICE on the paper you actually use — once at normal quality,
// once in the printer's economy/draft mode — and compare the two by eye. It
// prints the text inks at the four smallest sizes, the pale tints, the rule
// weights and a heading's solid band, which is where a printer gives out first, so
// whatever it degrades shows up here rather than in a document you needed.
//
// Duplex it, flipping on the long edge (the usual setting). Page 2 carries a
// heavy solid field placed where the observation window sits on page 1 — found
// at compile time, so it follows the window if the page above it changes — which
// is how you read show-through honestly.
//
// Build it like any document. From a repo that holds press at third_party/press:
//
//   sh third_party/press/tools/stamp.sh \
//       third_party/press/calibration.typ print/calibration.pdf \
//       --root . --font-path third_party/press/fonts --ignore-system-fonts
//
// and in press itself, `just build calibration.typ`.

#import "lib.typ": *

#show: brief.with(title: [Print calibration], author: "press",
  meta: [press #press-version · US Letter · actual size],
  footer: footer(status: [print at Actual size, duplex, both quality modes]))

#text(size: sz.micro, fill: ink-soft)[
  Print once normal, once economy. Mark the first row you would not want to read at arm's
  length — that row is your floor, and any document that relies on it needs changing.
]
#v(7pt)

= Ink ladder — the text inks at the smallest sizes

#let sample(colour) = {
  set text(fill: colour)
  stack(spacing: 4pt,
    text(size: sz.micro)[micro 8.6 — The quick brown fox jumps over the lazy dog · 0123456789],
    text(size: sz.fine)[fine 9.4 — The quick brown fox jumps over the lazy dog · 0123456789],
    text(size: sz.small)[small 10.2 — The quick brown fox jumps over the lazy dog],
    text(size: sz.body)[body 11 — The quick brown fox jumps over the lazy],
  )
}

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + rule-hair,
  inset: (x: 6pt, y: 6pt),
  align: (left + horizon, left + horizon),
  [#text(size: sz.fine, weight: 700)[ink] #linebreak()
   #text(size: sz.micro, fill: ink-soft)[17.85:1]], sample(ink),
  [#text(size: sz.fine, weight: 700)[ink-soft] #linebreak()
   #text(size: sz.micro, fill: ink-soft)[8.33:1]], sample(ink-soft),
  [#text(size: sz.fine, weight: 700)[ink-faint] #linebreak()
   #text(size: sz.micro, fill: ink-soft)[6.40:1]], sample(ink-faint),
  [#text(size: sz.fine, weight: 700)[slate] #linebreak()
   #text(size: sz.micro, fill: ink-soft)[8.40:1]], sample(slate),
)
#v(3pt)
#text(size: sz.micro, fill: ink-soft)[
  `ink-faint` is the one to watch. It is the lightest ink in the set and it carries the
  footer and the italic closing line of `stamp`, so it fails first in economy mode. If it
  survives here, nothing else in the library is at risk.
]
#v(8pt)

= Tints, rules and solids — what dithering damages

#let patch(label, fill-colour) = block(
  width: 100%, height: 30pt, fill: fill-colour, stroke: 0.4pt + rule-hair, radius: 1pt,
  inset: 4pt, text(size: sz.micro, fill: ink-soft)[#label],
)

#grid(columns: (1fr, 1fr, 1fr, 1fr, 1fr), gutter: 5pt,
  patch([paper-tint], paper-tint), patch([slate-tint], slate-tint),
  patch([ok-tint], ok-tint), patch([warn-tint], warn-tint), patch([bad-tint], bad-tint))
#v(5pt)
#text(size: sz.micro, fill: ink-soft)[
  These five are the palest fills in the set. Economy mode renders them with fewer dots, so
  they either go blotchy or disappear into the paper. Either failure is fine to accept — but
  decide it here, not mid-document.
]
#v(6pt)

#grid(columns: (1fr, 1fr), gutter: 10pt, align: (left + top, left + top),
  [#text(size: sz.micro, fill: ink-soft)[rule-hair 0.4pt] #v(3pt)
   #line(length: 100%, stroke: 0.4pt + rule-hair) #v(6pt)
   #text(size: sz.micro, fill: ink-soft)[rule-mid 0.6pt] #v(3pt)
   #line(length: 100%, stroke: 0.6pt + rule-mid) #v(6pt)
   #text(size: sz.micro, fill: ink-soft)[slate 2pt] #v(3pt)
   #line(length: 100%, stroke: 2pt + slate)],
  [#text(size: sz.micro, fill: ink-soft)[A heading's solid band — the ink-heavy element, and the
     one that shows through on duplex.] #v(4pt)
   #heading(outlined: false, bookmarked: false)[A section heading]],
)
#v(8pt)

= Duplex show-through window — hold it to the light

#block(width: 100%, height: 76pt, stroke: (paint: rule-mid, dash: "dashed", thickness: 0.7pt),
  radius: 2pt, inset: 8pt)[
  #text(size: sz.micro, fill: ink-soft)[
    Page 2 carries a heavy solid field. Whatever you see inside this box is coming through the
    sheet from the other side. Judge it against the paper you actually stock — a heavier
    sheet is the fix, not a lighter design, because a heading's band is what makes a section
    skippable at a glance.
  ]
] <window>

#stamp[Reprint this whenever the paper, the printer or the token set changes.]

#pagebreak()

#align(center)[#text(size: sz.fine, fill: ink-faint, style: "italic")[
  Page 2 exists to be looked through, not read.
]]
// Flipped on the long edge, page 2 shares page 1's heights, so the field is placed at the
// height of the window, with 24pt to spare above and below it. place() takes it out of the
// flow: where it lands moves nothing else, so the layout settles in one pass.
#context {
  let window = locate(<window>).position()
  place(top + left, dy: window.y - card.margin.top - 24pt,
    block(width: 100%, height: 76pt + 48pt, fill: ink, radius: 2pt, inset: 12pt,
      text(size: sz.small, fill: white)[
        Solid field for the show-through test. It sits behind the dashed window on page 1:
        turn back and look through it.
      ]))
}
#v(14pt)
#text(size: sz.small)[
  A link, as `link-note` prints it: #link("https://github.com/TylerVigario/press")[the press
  source]. On a screen it clicks; on paper its address is in the footnote. Check that the
  underline survives economy mode, since it, not the colour, is what marks a link in greyscale.
]
