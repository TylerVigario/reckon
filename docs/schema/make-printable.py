#!/usr/bin/env python3
"""Emit a printable schema reference from the .drawio files themselves.

The diagrams are the source. This reads them -- table names, every column, and
the notes pinned beside each cluster -- and writes Typst that press renders.
Nothing is transcribed, so the printable cannot drift from the drawings.

Usage:
    python3 docs/schema/make-printable.py
    just build docs/schema-reference.typ
"""

import pathlib
import re
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "schema-reference.typ"

CLUSTERS = [
    ("02-who-and-where.drawio",       "Who and where"),
    ("03-catalogue.drawio",           "What you sell"),
    ("04-work-captured.drawio",       "Work as it is captured"),
    ("05-agreements.drawio",          "Agreements"),
    ("06-money-out.drawio",           "Money out"),
    ("07-money-in.drawio",            "Money in"),
    ("08-operator-and-record.drawio", "The operator, and the record"),
]

seen = set()


def unescape(s):
    return ((s or "").replace("&quot;", '"').replace("&apos;", "'")
            .replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&"))


def read(path):
    cells = ET.parse(path).getroot().find("diagram/mxGraphModel/root")
    kids = {}
    for c in cells.findall("mxCell"):
        kids.setdefault(c.get("parent"), []).append(c)

    tables, notes = [], []
    for c in cells.findall("mxCell"):
        style = c.get("style") or ""
        if style.startswith("shape=table;"):
            rows = []
            for row in kids.get(c.get("id"), []):
                if not (row.get("style") or "").startswith("shape=tableRow"):
                    continue
                vals = [unescape(x.get("value")) for x in kids.get(row.get("id"), [])]
                if len(vals) == 3:
                    rows.append(tuple(vals))
            if rows:
                tables.append((unescape(c.get("value")), rows))
        elif style.startswith("text;") and c.get("value"):
            notes.append(unescape(c.get("value")))
    return tables, notes


def esc(s):
    for a, b in (("\\", "\\\\"), ("$", "\\$"), ("#", "\\#"), ("*", "\\*"),
                 ("_", "\\_"), ("@", "\\@"), ("<", "\\<"), (">", "\\>")):
        s = s.replace(a, b)
    return s


parts = []
for filename, title in CLUSTERS:
    tables, notes = read(HERE / filename)
    fresh = [(n, r) for n, r in tables if n not in seen]
    for n, _ in fresh:
        seen.add(n)
    if not fresh:
        continue

    parts.append(f"#colbreak(weak: true)\n#band[{title}]\n#v(5pt)\n")
    for name, rows in fresh:
        body = "\n".join(f"    [{'*'+esc(k)+'*' if k else ''}], [{esc(c)}], [{esc(t)}],"
                         for k, c, t in rows)
        parts.append(
            "#block(breakable: false)[\n"
            f'  #text(font: face-mono, size: sz.fine, weight: "bold")[{esc(name)}]\n'
            "  #v(3pt)\n  #sheet(\n    (auto, auto, 1fr),\n"
            "    ([], [Column], [Type]),\n    size: sz.micro,\n"
            + body + "\n  )\n]\n#v(7pt)\n")

    for n in notes:
        for para in [p.strip() for p in n.split("\n\n") if p.strip()]:
            parts.append(f'#callout(tone: "note")[{esc(para)}]\n#v(4pt)\n')
    parts.append("#v(6pt)\n")

HEAD = r'''// The reckon schema, as a printed reference.
//
// GENERATED from the .drawio files by docs/schema/make-printable.py. Change a
// diagram and regenerate; do not hand-edit this file.
//
// It carries what a diagram cannot: every column of every table, in one
// sequence, readable beside a keyboard. The notes beside each cluster quote
// docs/decisions.md, and anything marked [claude] is my reading rather than
// Tyler's.

#import "@vts/press:0.1.0": *

#set page(..dense, footer: context {
  set text(size: sz.micro, fill: ink-faint)
  grid(columns: (1fr, auto),
    align(left)[reckon · schema reference · generated from the .drawio files],
    align(right)[Page #counter(page).display("1 of 1", both: true)])
})
#set text(font: face-text, size: sz.fine, fill: ink, lang: "en")
#set par(leading: 0.55em, spacing: 0.6em, justify: false)
#show raw: set text(font: face-mono, size: sz.micro)

#titlebar([reckon], [The schema, as a printed reference])
#v(6pt)

#text(size: sz.small)[
  @@N_TABLES@@ tables across @@N_CLUSTERS@@ clusters. The @@N_FILES@@ `.drawio` files in
  `docs/schema/` carry the relationships; `docs/decisions.md` carries the
  decisions, verbatim, and is the authority. A table drawn in more than one
  cluster is listed once, under the first.
]

#v(10pt)
'''

TAIL = r'''
#pagebreak()

#band[What the database refuses]
#v(5pt)

#text(size: sz.fine)[
  Where the database can hold a rule rather than trusting the application to
  remember it, it does. `db/test/constraints.sql` proves each one both ways —
  the refusal happens, and the legitimate case beside it still works.
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
  [Editing, deleting or adding lines on a sent invoice], [corrections are credit notes],
  [Changing a sent invoice's due date], [only its status may move],
  [Voiding without a reason], [],
  [More stock left than ever arrived], [`qty_remaining <= qty_received`],
  [Two rates for one site on one day], [site rates are dated rows],
  [A payout whose net ignores the fee], [`net = gross - fees`],
  [Two "any entity" prices for one crew and day], [most specific match wins],
)

#v(10pt)
#band[Not decided]
#v(5pt)

#text(size: sz.fine)[
  From `docs/decisions.md`, read at generation. These are questions, not gaps
  to be filled in by reasoning.
]
#v(4pt)

#sheet(
  (auto, 1fr),
  ([], [Open]),
  size: sz.micro,
@@NOT_DECIDED@@
)

#v(12pt)
#stamp[Generated from `docs/schema/`. Change a diagram and regenerate.]
'''

def not_decided():
    """The register's own list of open questions, as rows.

    Read rather than restated: this table was a hand copy, and it went on
    listing the migration cutover as open after the register had it decided.
    Each bullet is **title** then, optionally, a dash and what is open about it.
    """
    md = (HERE.parent / "decisions.md").read_text()
    section = md.split("## Not decided", 1)[1].split("\n## ", 1)[0]
    rows = []
    for item in re.split(r"\n- ", "\n" + section.split("\n\n", 1)[1].split("\n---", 1)[0]):
        item = " ".join(item.split())
        if not item.startswith("**"):
            continue
        m = re.match(r"\*\*(.+?)\*\*\s*(?:—\s*)?(.*)", item)
        title, rest = m.group(1).rstrip("."), m.group(2).strip()
        rest = re.sub(r"`([^`]+)`", r"\1", rest)
        rows.append(f"  [{esc(title)}], [{esc(rest)}],")
    if not rows:
        raise SystemExit("decisions.md has no Not decided list to read")
    return "\n".join(rows)


WORDS = {2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight",
         9: "Nine", 10: "Ten", 32: "Thirty-two", 34: "Thirty-four", 35: "Thirty-five",
         36: "Thirty-six", 37: "Thirty-seven", 38: "Thirty-eight"}
word = lambda n: WORDS.get(n, str(n))
TAIL = TAIL.replace("@@NOT_DECIDED@@", not_decided())
head = (HEAD.replace("@@N_TABLES@@", word(len(seen)))
            .replace("@@N_CLUSTERS@@", word(len(CLUSTERS)).lower())
            .replace("@@N_FILES@@", word(len(list(HERE.glob("*.drawio")))).lower()))

OUT.write_text(head + "#columns(2, gutter: 16pt)[\n" + "\n".join(parts) + "\n]\n" + TAIL)
print(f"{OUT}")
print(f"  {len(seen)} tables from {len(CLUSTERS)} clusters")
print("  build:  just build docs/schema-reference.typ")
