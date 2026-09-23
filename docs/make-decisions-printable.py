#!/usr/bin/env python3
"""Emit a printable decisions register from docs/decisions.md.

The markdown is the source. This reads it and writes Typst that press renders,
so the printable cannot drift from the register -- the same arrangement
docs/schema/make-printable.py has with the diagrams, and for the same reason: a
transcription is a second copy, and a second copy goes stale quietly.

decisions.md is the authority for the whole project. What this adds is a form
that can be read away from a screen, with the verbatim quotes set apart from the
prose so it stays obvious which words are Tyler's and which are not.

Usage:
    python3 docs/make-decisions-printable.py
    just build docs/decisions.typ
"""

import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "decisions.md"
OUT = HERE / "decisions.typ"


def esc(s):
    """Escape Typst's markup characters in plain text.

    Markdown's own backslash escapes come off first. The register writes `\\$400`
    so the dollar is not read as maths by a markdown renderer; leaving it in
    would print a literal backslash on the page, inside a quote that is supposed
    to be verbatim.
    """
    s = re.sub(r"\\([\\`*_{}\[\]()#+\-.!$|>])", r"\1", s)
    for a, b in (("\\", "\\\\"), ("#", "\\#"), ("$", "\\$"), ("*", "\\*"),
                 ("_", "\\_"), ("@", "\\@"), ("<", "\\<"), (">", "\\>"),
                 ("[", "\\["), ("]", "\\]"), ("`", "\\`")):
        s = s.replace(a, b)
    return s


def inline(s):
    """Markdown inline markup -> Typst, escaping everything that is not markup.

    Code spans and links are lifted out first so their contents are never read
    as markup, then put back. Order matters for the rest: bold before italic, or
    `**x**` parses as an empty italic wrapping an italic.
    """
    held = []

    def hold(t):
        held.append(t)
        return f"\x00{len(held) - 1}\x00"

    s = re.sub(r"`([^`]+)`", lambda m: hold("`" + m.group(1) + "`"), s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)",
               lambda m: hold('#link("%s")[%s]' % (m.group(2), esc(m.group(1)))), s)
    # A mark, not a link, and the one thing in this document a reader must be
    # able to find at a glance: it says the words are mine rather than his.
    s = s.replace("[claude]", hold('#text(fill: warn, weight: 700)[\\[claude\\]]'))
    s = re.sub(r"\*\*([^*]+)\*\*", lambda m: hold("*" + esc(m.group(1)) + "*"), s)
    s = re.sub(r"(?<!\w)\*([^*]+)\*(?!\w)", lambda m: hold("_" + esc(m.group(1)) + "_"), s)
    s = esc(s)
    # To a fixed point: a held span can contain another placeholder -- bold
    # wrapping a [claude] mark is the case that occurs -- and a single pass
    # leaves the inner one in the output as a literal NUL.
    while "\x00" in s:
        before = s
        s = re.sub(r"\x00(\d+)\x00", lambda m: held[int(m.group(1))], s)
        if s == before:
            raise AssertionError("a placeholder survived restoration: " + repr(s[:120]))
    return s


def cells(row):
    return [c.strip() for c in row.strip().strip("|").split("|")]


lines = SRC.read_text().split("\n")
parts = []
lead = []
i = 0

# Everything above the first rule is the register's own preamble, and it says
# what the document is for. It becomes the lead rather than a section.
while i < len(lines) and lines[i].strip() != "---":
    if lines[i].startswith("# "):
        i += 1
        continue
    lead.append(lines[i])
    i += 1
i += 1

lead_text = " ".join(x.strip() for x in lead if x.strip())

while i < len(lines):
    line = lines[i]
    stripped = line.strip()

    if not stripped or stripped == "---":
        i += 1
        continue

    if stripped.startswith("## "):
        parts.append("#band[%s]\n#v(4pt)\n" % inline(stripped[3:]))
        i += 1
        continue

    if stripped.startswith("### "):
        parts.append('#text(size: sz.small, weight: 700, fill: steel)[%s]\n#v(3pt)\n'
                     % inline(stripped[4:]))
        i += 1
        continue

    # A quote is the whole reason this document exists. Consecutive `>` lines
    # are one utterance per line -- several quotes often sit together under one
    # decision -- so each becomes its own line inside a single callout.
    if stripped.startswith(">"):
        quotes = []
        while i < len(lines) and lines[i].strip().startswith(">"):
            q = lines[i].strip().lstrip(">").strip()
            if q:
                quotes.append(inline(q))
            i += 1
        parts.append("#callout(tone: \"note\")[\n  %s\n]\n#v(4pt)\n"
                     % " \\\n  ".join(quotes))
        continue

    if stripped.startswith("|"):
        rows = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            r = cells(lines[i])
            if not all(re.fullmatch(r":?-{2,}:?", c) for c in r if c):
                rows.append(r)
            i += 1
        if rows:
            n = max(len(r) for r in rows)
            head = rows[0]
            body = rows[1:] if any(h for h in head) else rows
            if not any(h for h in head):
                head = [""] * n
            cols = "(auto, " + ", ".join(["1fr"] * (n - 1)) + ")" if n > 1 else "(1fr,)"
            head_t = ", ".join("[%s]" % inline(h) for h in head)
            body_t = "\n".join("  " + ", ".join("[%s]" % inline(c) for c in r) + ","
                               for r in body)
            parts.append("#sheet(\n  %s,\n  (%s),\n  size: sz.fine,\n%s\n)\n#v(5pt)\n"
                         % (cols, head_t, body_t))
        continue

    if stripped.startswith("- ") or stripped.startswith("* "):
        items = []
        while i < len(lines) and (lines[i].strip().startswith("- ")
                                  or lines[i].strip().startswith("* ")):
            items.append(inline(lines[i].strip()[2:]))
            i += 1
        parts.append("#list(%s)\n#v(4pt)\n" % ", ".join("[%s]" % x for x in items))
        continue

    para = []
    while i < len(lines) and lines[i].strip() and not re.match(
            r"^\s*(#{2,3} |> |\||- |\* |---$)", lines[i]):
        para.append(lines[i].strip())
        i += 1
    if para:
        parts.append("%s\n#v(4pt)\n" % inline(" ".join(para)))

HEAD = r'''// The decisions register, as a printed document.
//
// GENERATED from docs/decisions.md by docs/make-decisions-printable.py. Change
// the register and regenerate; do not hand-edit this file.
//
// The register is the authority for this whole project -- the schema, the
// diagrams, the DDL and the code derive from it. This is the same words, set to
// be read on paper: every quote is verbatim and boxed, and anything marked
// [claude] is my reading rather than Tyler's.

#import "@vts/press:0.1.0": *

#set page(..reading, footer: context {
  set text(size: sz.micro, fill: ink-faint)
  grid(columns: (1fr, auto),
    align(left)[reckon · decisions · generated from `docs/decisions.md`],
    align(right)[Page #counter(page).display("1 of 1", both: true)])
})
#set text(font: face-text, size: sz.fine, fill: ink, lang: "en")
#set par(leading: 0.58em, spacing: 0.62em, justify: false)
#show raw: set text(font: face-mono, size: sz.micro)

#titlebar([reckon], [Decisions, in Tyler's words])
#v(6pt)

#text(size: sz.small, fill: ink-soft)[@@LEAD@@]

#v(10pt)
'''

TAIL = ('\n#v(12pt)\n#stamp[Generated from `docs/decisions.md`. '
        'Change the register and regenerate.]\n')

OUT.write_text(HEAD.replace("@@LEAD@@", inline(lead_text)) + "\n".join(parts) + TAIL)
print(f"{OUT}")
print(f"  {sum(1 for p in parts if p.startswith('#band['))} sections, "
      f"{sum(1 for p in parts if p.startswith('#callout'))} quote blocks")
print("  build:  just build docs/decisions.typ")
