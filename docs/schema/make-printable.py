#!/usr/bin/env python3
"""Read the schema reference's tables and notes out of the .drawio files.

The diagrams are the source. This reads them -- table names, every column, and
the notes pinned beside each cluster -- and writes what it found as data,
docs/schema/reference.json, which docs/schema-reference.typ reads. Nothing is
transcribed, so the printable cannot drift from the drawings.

It writes data and never Typst. A value set from data is text, whatever
characters it holds; written into markup, every one of them would need
escaping, and an escape that missed one would print it wrong or lose the rest
of its line. The build follows the data: a changed reference.json builds the
reference again.

Usage:
    python3 docs/schema/make-printable.py
    npm run print:build -- docs/schema-reference.typ
"""

import json
import pathlib
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "reference.json"

CLUSTERS = [
    ("02-who-and-where.drawio",       "Who and where"),
    ("03-catalogue.drawio",           "What you sell"),
    ("04-work-captured.drawio",       "Work as it is captured"),
    ("05-agreements.drawio",          "Agreements"),
    ("06-money-out.drawio",           "Money out"),
    ("07-money-in.drawio",            "Money in"),
    ("08-operator-and-record.drawio", "The operator, and the record"),
    ("09-pay.drawio",                 "Pay, as it was paid"),
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


sections = []
for filename, title in CLUSTERS:
    tables, notes = read(HERE / filename)
    fresh = [(n, r) for n, r in tables if n not in seen]
    for n, _ in fresh:
        seen.add(n)
    if not fresh:
        continue
    sections.append({
        "title": title,
        "tables": [{"name": name, "rows": [list(r) for r in rows]} for name, rows in fresh],
        # A note's paragraphs, each its own callout.
        "notes": [p.strip() for n in notes for p in n.split("\n\n") if p.strip()],
    })

# Typst does not spell numbers, so the counts the reference opens with are
# written out here.
WORDS = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight",
         9: "nine", 10: "ten", 32: "thirty-two", 34: "thirty-four", 35: "thirty-five",
         36: "thirty-six", 37: "thirty-seven", 38: "thirty-eight", 39: "thirty-nine",
         40: "forty"}
word = lambda n: WORDS.get(n, str(n))

OUT.write_text(json.dumps({
    "counted": {
        # It opens a sentence.
        "tables": word(len(seen)).capitalize(),
        "clusters": word(len(CLUSTERS)),
        "files": word(len(list(HERE.glob("*.drawio")))),
    },
    "sections": sections,
}, ensure_ascii=False, indent=1) + "\n")
print(f"{OUT}")
print(f"  {len(seen)} tables from {len(CLUSTERS)} clusters")
print("  build:  npm run print:build -- docs/schema-reference.typ")
