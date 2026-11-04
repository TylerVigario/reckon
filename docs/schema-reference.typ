// The reckon schema, as a printed reference.
//
// Its tables and notes are read from docs/schema/reference.json, which
// docs/schema/make-printable.py writes from the .drawio files. Change a diagram
// and run that; the reference follows. What is written here is the reference's
// own: its frame, and what the database refuses.
//
// It carries what a diagram cannot: every column of every table, in one
// sequence, readable beside a keyboard. The notes beside each cluster say why
// a table is the shape it is.

#import "/third_party/press/lib.typ": *

#show: brief.with(
  title: [reckon schema reference],
  meta: [The schema, as a printed reference],
  preset: dense,
  footer: footer(status: [generated from the .drawio files]),
)
#set text(size: sz.fine)
#set par(leading: 0.55em, spacing: 0.6em, justify: false)
#show raw: set text(size: sz.micro)

// Every value below is set as text, whatever characters it holds.
#let reference = json("schema/reference.json")

// Markup would have set the notes as a typesetter does: a word's apostrophe
// curled, two hyphens an en dash, a run of spaces one space. A string is set as
// written, so those three are done here; nothing in it is read as markup.
#let typeset(s) = (
  s
    .replace(regex(" {2,}"), " ")
    .replace("--", "–")
    .replace(regex("(\\w)'"), m => m.captures.at(0) + "’")
)

#text(size: sz.small)[
  #reference.counted.tables tables across #reference.counted.clusters clusters. The #reference.counted.files `.drawio` files in
  `docs/schema/` carry the relationships; the schema's comments carry the reasoning.
  A table drawn in more than one cluster is listed once, under the first.
]

#v(10pt)
#columns(2, gutter: 16pt)[
  #for section in reference.sections [
    #colbreak(weak: true)
    == #typeset(section.title)

    #for table in section.tables [
      #block(breakable: false)[
        #text(font: face-mono, size: sz.fine, weight: "bold", table.name)
        #v(3pt)
        #sheet(
          (auto, auto, 1fr),
          ([], [Column], [Type]),
          size: sz.micro,
          ..table.rows.map(row => row.map(typeset)).map(((key, column, type)) => (
            strong(key),
            column,
            type,
          )).flatten(),
        )
      ]
      #v(7pt)

    ]
    #for note in section.notes [
      #callout(tone: "note", typeset(note))
      #v(4pt)

    ]
    #v(6pt)

  ]
]

#pagebreak()

== What the database refuses

#text(size: sz.fine)[
  Where the database can hold a rule rather than trusting the application to
  remember it, it does. Each of these is a constraint or a trigger in the
  schema, not a check the application has to remember.
]
#v(5pt)

#sheet(
  (1fr, auto),
  ([Refused], [Why]),
  size: sz.micro,
  [The same time entry twice], [`client_uuid` is made on the phone and unique],
  [Billable work with nobody to bill], [an entity is required once `billable`],
  [Tax exempt with no certificate], [CDTFA needs it to support the sale],
  [A rate override with no reason], [an unexplained rate is not auditable],
  [Tax on a line marked untaxable], [],
  [A line claiming two sources], [provenance is one FK, or none],
  [The same trip leg billed twice], [],
  [Editing, deleting, adding or moving lines on a sent invoice], [corrections are credit notes],
  [Changing a sent invoice's due date], [only its status may move],
  [Putting a sent invoice back to draft], [it would open every field again],
  [Deleting a sent invoice], [it is voided instead],
  [Voiding without a reason], [],
  [More stock left than ever arrived], [`qty_remaining <= qty_received`],
  [Drawing more than is on the shelf], [a draw comes off its lot, which cannot go below nothing],
  [A line drawing another material's stock], [a draw names the material of its line and its lot],
  [Changing what a sent invoice drew from stock], [it is settled with its lines],
  [A payout whose net ignores the fee], [`net = gross - fees`],
  [Two prices for one service, client and day], [one price per day],
)

#v(12pt)
#stamp[Generated from `docs/schema/`. Change a diagram and regenerate.]
