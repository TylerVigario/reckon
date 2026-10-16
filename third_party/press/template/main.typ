// A brief, from press's general-purpose template. It imports press and applies brief(), which
// sets the page, the type and the head; the rest is placeholder for your own. Use it as it is,
// or copy brief() into your repository and change your copy: press asks neither.
//
//   sh third_party/press/tools/new.sh docs/<name>    (or `just new docs/<name>`)
//
// copies it to docs/<name>/main.typ, with the import below rewritten to where press sits.
// In press's own tree the import is relative, ../lib.typ, so the starter compiles there.
//
// ---------------------------------------------------------------------------
// The conventions this starter encodes. They are what make a document
// scannable; the tokens alone will not do it.
//
//   1. MEAT FIRST. Whatever the reader must act on goes at the top. Attention
//      is spent before it is earned back — do not make them read design detail
//      to reach a decision.
//   2. ONE IDEA PER UNIT, opened by a bold LEAD. That lead is the highlight,
//      pre-made, so nobody has to reach for a marker.
//   3. UNITS ARE SELF-CONTAINED. Nothing may assume the unit above it was
//      read. Sections get read out of order and returned to weeks later.
//   4. BANDS CARRY A ROLE — decide / design / reference. Skipping a section
//      should be a deliberate choice, not something discovered afterwards.
//   5. COLOUR IS STATE, never decoration, and it gets a legend.
//   6. NO LENGTH CAP. If a unit needs depth, give it depth, or push the depth
//      to a second layer — but never delete it to fit a layout. If it does not
//      fit, the layout is what changes.
// ---------------------------------------------------------------------------

#import "../lib.typ": *

// The document's name, set once: a PDF viewer shows it in its title bar and lists the file by
// it, and the head and footer print it from here.
#show: brief.with(
  title: [Document title],
  author: "Your name",
  meta: [scope · date],
  status: [status],
)

// ---- Meat first ----
#band-strong([What the reader must act on], "decide — start here", color: bad)

#grid(columns: (1fr, 1fr), gutter: 9pt,
  unit([First thing], "bad")[The lead states the point outright.][
    The body carries as much as the idea needs. No cap.
  ],
  unit([Second thing], "warn")[A conditional — true only in some case.][
    Say which case, in the body.
  ],
)
#v(8pt)

// ---- Design ----
#band-strong([How it works], "design")

#grid(columns: (1fr, 1fr), gutter: 9pt, row-gutter: 6pt,
  unit([A property], "ok")[Settled, no action needed.][Detail here.],
  unit([Another property], "note")[Neutral statement of fact.][Detail here.],
)
#v(8pt)

// ---- Reference ----
#band-strong([Reference — skip unless you need it], "reference", color: steel)

#matrix(
  ([Axis], [Consequence]),
  [Something], [What follows from it.],
)

#stamp[Status line — what this document is, and is not.]
