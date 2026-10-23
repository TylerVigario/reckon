// A brief, from press's general-purpose template. It imports press and applies brief(), which
// sets the page, the type and the head; the rest is placeholder for your own. Use it as it is,
// apply your repository's own template that wraps brief(), or copy brief() into your repository
// and change your copy: press prefers none of them.
//
//   sh third_party/press/tools/new.sh docs/<name>    (or `just new docs/<name>`)
//
// copies it to docs/<name>/main.typ, with the import below rewritten to where press sits.
// In press's own tree the import is relative, ../lib.typ, so the starter compiles there.
//
// What only you can supply, a name, a date, an address, is marked open(): it prints in red, and
// every build says how many are left until each is replaced. The rest is an example to rewrite.
//
// ---------------------------------------------------------------------------
// The conventions this starter encodes, brief's own. They are what make a brief
// scannable; the tokens alone will not do it.
//
//   1. MEAT FIRST. Whatever the reader must act on goes at the top. Attention
//      is spent before it is earned back — do not make them read design detail
//      to reach a decision.
//   2. ONE IDEA PER UNIT, opened by a bold LEAD. That lead is the highlight,
//      pre-made, so nobody has to reach for a marker.
//   3. UNITS ARE SELF-CONTAINED. Nothing may assume the unit above it was
//      read. Sections get read out of order and returned to weeks later.
//   4. A HEADING SAYS WHAT ITS SECTION IS FOR — act on this, how it works,
//      reference. Skipping a section should be a deliberate choice, not
//      something discovered afterwards.
//   5. COLOUR IS STATE, never decoration, and it gets a legend.
//   6. NO LENGTH CAP. If a unit needs depth, give it depth, or push the depth
//      to a second layer — but never delete it to fit a layout. If it does not
//      fit, the layout is what changes.
// ---------------------------------------------------------------------------

#import "../lib.typ": *

// The document's name, set once: a PDF viewer shows it in its title bar and lists the file by
// it, and the header and footer print it from here.
#show: brief.with(
  title: open[Document title],
  author: "Your name",
  meta: open[scope · date],
  footer: footer(status: open[status]),
  legend: ([Colour is state. Each heading says what its section is for.],
    chip([SETTLED], "ok"), chip([CONDITIONAL], "warn"), chip([DECIDE], "bad")),
)

// ---- Meat first ----
= What the reader must act on — start here

#units(
  unit([First thing], "bad")[The lead states the point outright.][
    The body carries as much as the idea needs. No cap.
  ],
  unit([Second thing], "warn")[A conditional — true only in some case.][
    Say which case, in the body.
  ],
)
#v(8pt)

// ---- Design ----
= How it works

#units(
  unit([A property], "ok")[Settled, no action needed.][Detail here.],
  unit([Another property], "note")[Neutral statement of fact.][Detail here.],
)
#v(8pt)

// ---- Reference ----
= Reference — skip unless you need it <depth>

#sheet((auto, 1fr), ([Axis], [Consequence]), size: sz.fine,
  [Something], [What follows from it.],
)

#stamp[Status line — what this document is, and is not.]
