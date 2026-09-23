#!/usr/bin/env python3
"""Render the .drawio schema diagrams as a printable, without draw.io.

The .drawio files carry complete geometry -- every table, row and cell has an
absolute or parent-relative position, and every edge names its endpoints and the
sides it leaves and enters by. That is enough to draw them, so this reads the
XML and emits SVG rather than shelling out to an editor that is not installed
and would have to be driven headless to do the same job.

The SVG goes inline into docs/schema-diagrams.typ. Nothing is written beside the
sources and nothing derived is committed twice: change a diagram, regenerate,
and the printable follows.

Usage:
    python3 docs/schema/make-diagrams.py
    just build docs/schema-diagrams.typ
"""

import pathlib
import re
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "schema-diagrams.typ"

PAGES = [
    ("01-overview.drawio", "The shape of it", "Every cluster, and how they meet."),
    ("02-who-and-where.drawio", "Who and where", "Clients, their sites, and the people to ask for."),
    ("03-catalogue.drawio", "What you sell", "Services, materials, and what each is worth."),
    ("04-work-captured.drawio", "Work as it is captured", "Time and travel, as they are recorded."),
    ("05-agreements.drawio", "Agreements", "Recurring charges and what they include."),
    ("06-money-out.drawio", "Money out", "Invoices and the lines they are built from."),
    ("07-money-in.drawio", "Money in", "Payments, credits, and what closes an invoice."),
    ("08-operator-and-record.drawio", "The operator, and the record",
     "The business itself, who signs in, and what changed."),
]

# Slack inside the viewBox. Edge labels are placed after the extent is taken
# from the boxes, so a label near an edge can sit slightly outside it; this is
# the room for that, and it keeps the drawing off the page margin.
MARGIN = 30


def sval(style, key, default=None):
    m = re.search(rf"(?:^|;){re.escape(key)}=([^;]*)", style or "")
    return m.group(1) if m else default


def xesc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def unesc(s):
    return ((s or "").replace("&quot;", '"').replace("&apos;", "'")
            .replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&"))


def geo(cell):
    g = cell.find("mxGeometry")
    if g is None:
        return 0.0, 0.0, 0.0, 0.0
    f = lambda k: float(g.get(k) or 0)
    return f("x"), f("y"), f("width"), f("height")


def render(path):
    root = ET.parse(path).getroot().find("diagram/mxGraphModel/root")
    cells = root.findall("mxCell")
    by_id = {c.get("id"): c for c in cells}
    kids = {}
    for c in cells:
        kids.setdefault(c.get("parent"), []).append(c)

    out, boxes = [], {}

    def text(x, y, s, size, colour, anchor="start", weight="normal", family="Liberation Sans"):
        out.append(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size}" '
                   f'fill="{colour}" text-anchor="{anchor}" font-weight="{weight}">{xesc(s)}</text>')

    for c in cells:
        style = c.get("style") or ""
        x, y, w, h = geo(c)

        if style.startswith("shape=table;"):
            boxes[c.get("id")] = (x, y, w, h)
            head = float(sval(style, "startSize", "26"))
            out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" '
                       f'fill="#ffffff" stroke="#2382b3" stroke-width="1.2"/>')
            out.append(f'<path d="M{x} {y + head} H{x + w}" stroke="#2382b3" stroke-width="1.2"/>')
            text(x + w / 2, y + head - 8, unesc(c.get("value")), 12.5, "#2e3a68", "middle", "bold")
            for row in kids.get(c.get("id"), []):
                if not (row.get("style") or "").startswith("shape=tableRow"):
                    continue
                _, ry, _, rh = geo(row)
                if ry > head:
                    out.append(f'<path d="M{x} {y + ry} H{x + w}" stroke="#e6eaf0" stroke-width="0.6"/>')
                for cl in kids.get(row.get("id"), []):
                    cx, _, cw, _ = geo(cl)
                    st = cl.get("style") or ""
                    colour = sval(st, "fontColor", "#2e3a68")
                    align = sval(st, "align", "left")
                    bold = "bold" if "fontStyle=1" in st else "normal"
                    fam = "Liberation Mono" if colour == "#2382b3" else "Liberation Sans"
                    tx = x + cx + (cw / 2 if align == "center" else 6)
                    anc = "middle" if align == "center" else "start"
                    text(tx, y + ry + rh - 7, unesc(cl.get("value")), 10, colour, anc, bold, fam)

        elif style.startswith("rounded=1"):
            boxes[c.get("id")] = (x, y, w, h)
            stroke = sval(style, "strokeColor", "#4a5468")
            sw = sval(style, "strokeWidth", "1")
            out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="#ffffff" '
                       f'stroke="{stroke}" stroke-width="{sw}"/>')
            for n, part in enumerate(unesc(c.get("value")).split("\n")):
                text(x + w / 2, y + h / 2 + 4 + n * 13, part, 11.5, "#2e3a68", "middle", "bold")


    for c in cells:
        style = c.get("style") or ""
        if not style.startswith("edgeStyle"):
            continue
        s, t = boxes.get(c.get("source")), boxes.get(c.get("target"))
        if not s or not t:
            continue
        ex, ey = float(sval(style, "exitX", "1")), float(sval(style, "exitY", "0.5"))
        nx, ny = float(sval(style, "entryX", "0")), float(sval(style, "entryY", "0.5"))
        x1, y1 = s[0] + s[2] * ex, s[1] + s[3] * ey
        x2, y2 = t[0] + t[2] * nx, t[1] + t[3] * ny
        mid = (x1 + x2) / 2 if ex != ey else x1
        d = (f"M{x1:.1f} {y1:.1f} H{mid:.1f} V{y2:.1f} H{x2:.1f}" if ex in (0, 1)
             else f"M{x1:.1f} {y1:.1f} V{(y1 + y2) / 2:.1f} H{x2:.1f} V{y2:.1f}")
        out.append(f'<path d="{d}" fill="none" stroke="#8b96a5" stroke-width="1"/>')
        out.append(f'<circle cx="{x2:.1f}" cy="{y2:.1f}" r="2.6" fill="#8b96a5"/>')
        if c.get("value"):
            inside = lambda px, py: any(bx <= px <= bx + bw and by <= py <= by + bh
                                        for bx, by, bw, bh in boxes.values())
            spots = ([(mid, (y1 + y2) / 2 - 3, "middle")] if y1 != y2
                     else [((x1 + x2) / 2, y1 - 5, "middle")])
            spots += [(x1 + 8, y1 - 5, "start"), (x2 - 8, y2 - 5, "end")]
            for lx, ly, anc in spots:
                if not inside(lx, ly):
                    text(lx, ly, unesc(c.get("value")), 9, "#6b7686", anc)
                    break

    xs = [b[0] for b in boxes.values()] + [0]
    ys = [b[1] for b in boxes.values()] + [0]
    xe = [b[0] + b[2] for b in boxes.values()] + [10]
    ye = [b[1] + b[3] for b in boxes.values()] + [10]
    x0, y0 = min(xs) - MARGIN, min(ys) - MARGIN
    w0, h0 = max(xe) - x0 + MARGIN, max(ye) - y0 + MARGIN
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.0f} {y0:.0f} {w0:.0f} {h0:.0f}" '
            f'width="{w0:.0f}" height="{h0:.0f}">' + "".join(out) + "</svg>")




HEAD = r'''// The schema diagrams, as a printed set.
//
// GENERATED from the .drawio files by docs/schema/make-diagrams.py. Change a
// diagram and regenerate; do not hand-edit this file.
//
// One diagram per page, landscape, each scaled to fit. The notes pinned beside
// each cluster are not drawn: they are prose, and docs/schema-reference.typ
// already carries every one of them from these same files. The
// SVG is inline rather than beside the sources, so there is no derived file to
// keep in step -- the drawings remain the only copy.
//
// docs/schema-reference.typ is the companion: it carries every column of every
// table in one sequence. This carries what that cannot, which is what points at
// what.

#import "@vts/press:0.1.0": *

#set page(paper: "us-letter", flipped: true,
  margin: (x: 0.65in, top: 0.6in, bottom: 0.75in), footer-descent: 0.12in,
  footer: context {
    set text(size: sz.micro, fill: ink-faint)
    grid(columns: (1fr, auto),
      align(left)[reckon · schema diagrams · generated from `docs/schema/`],
      align(right)[Page #counter(page).display("1 of 1", both: true)])
  })
#set text(font: face-text, size: sz.fine, fill: ink, lang: "en")
#show raw: set text(font: face-mono, size: sz.micro)
'''

parts = []
for i, (filename, title, blurb) in enumerate(PAGES):
    svg = render(HERE / filename)
    body = svg.replace("\\", "\\\\").replace('"', '\\"')
    parts.append(
        ("" if i == 0 else "#pagebreak()\n")
        + f"#titlebar([{title}], [{blurb}])\n#v(8pt)\n"
        + '#align(center)[#image(bytes("' + body
        + '"), format: "svg", width: 98%, height: 74%, fit: "contain")]\n')

OUT.write_text(HEAD + "\n" + "\n".join(parts))
print(f"{OUT}")
print(f"  {len(PAGES)} diagrams, {OUT.stat().st_size // 1024} KB of inline SVG")
print("  build:  just build docs/schema-diagrams.typ")
