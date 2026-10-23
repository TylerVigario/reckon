#!/usr/bin/env python3
"""Report lines of text printed on top of other lines, per page.

Exists because a document can collide with itself, pass every other check, and
reach paper. Nothing typst emits is wrong — the document is valid and it simply
renders on top of itself — so there is no warning to read and no font to blame.
It was found in practice by a person looking at a rendered page, more than once,
which is the failure mode `check` exists to remove.

Reads word positions via `pdftotext -bbox-layout`, so it needs poppler — the
same dependency `check` already asserts — plus a Python to run this file.

WHY NOT THE RASTER, given the printable-area check already renders each page
----------------------------------------------------------------------------
Because a rendered page has thrown the answer away. "Two lines drawn on each
other" and "one line drawn once" are the same pixels; nothing in the image says
what was drawn on top of what. Tested anyway rather than assumed — merged-band
detection over a five-document corpus at six thresholds from 0.001 to 0.05 scored
ZERO on the known defect at every threshold while false-positiving on a clean
document at the low end. There is no setting that separates them.

`pdftotext` works precisely because it reads the text-positioning operators the
raster discards. That is also why the printable-area check stays raster while
this one cannot: "is there ink near the paper edge" needs no layering at all and
must see panels and rules as well as glyphs, whereas layering is the entire
question here.

WHY POPPLER'S LINE GROUPING RATHER THAN OUR OWN
-----------------------------------------------
The first attempt grouped words into lines by rounding their vertical midpoint.
On a known-good four-page document that produced 23 false positives, worst at
7.90pt, every one of them prose paired with an inline `raw` span: mono at a
smaller size has a different vertical centre, so one visual line splits into two
bands and reads as a collision.

Those false positives were LARGER than the real defect they were meant to find
(7.90pt against 2.96pt), so no tolerance could separate them. `-bbox-layout`
emits poppler's own <line> elements, which span mixed-font runs correctly and
take the count to zero.
"""
import os, re, subprocess, sys, tempfile, pathlib

# A line pair must overlap by more than this to be reported. Not cosmetic, and
# not tuned to taste: rotated text is the one construct that produces phantom
# overlaps, because poppler segments rotated glyphs into fragments and reports
# them as separate lines. Measured worst case was 0.13pt, on a page carrying 90°
# and -45° rotations. The smallest GENUINE collision measured across six defect
# shapes was 2.72pt. The floor sits in the middle of a gap with nothing in it.
EPSILON_PT = 0.5

def die(msg):
    """The pass could not run: exit 2, apart from 1 for a finding, so check never takes a
    missing or broken tool for a finding a document has accepted."""
    print(msg, file=sys.stderr)
    sys.exit(2)

PDFTOTEXT = os.environ.get("PRESS_PDFTOTEXT", "pdftotext")

# Poppler escapes &, < and > in word text, so a parser is correct here and a
# naive split is not. ElementTree is stdlib, which keeps this dependency-free.
import xml.etree.ElementTree as ET


def layout(pdf, tmp):
    out = pathlib.Path(tmp) / "layout.xml"
    try:
        subprocess.run([PDFTOTEXT, "-bbox-layout", pdf, str(out)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        # Same reasoning as ink-margin.py: without this the failure is a bare
        # traceback naming neither the missing tool nor the remedy.
        die(f"press: overlap check needs poppler; {PDFTOTEXT} not found\n"
                 f"       set PRESS_PDFTOTEXT to poppler's binary if it is not on PATH")
    except OSError as e:
        # FOUND but not runnable. Aiming PRESS_PDFTOTEXT at a shell script on
        # Windows raises WinError 193 rather than FileNotFoundError, and the bare
        # traceback for that names CreateProcess instead of the variable that
        # caused it. Measured while testing the branch above.
        die(f"press: {PDFTOTEXT} could not be run ({e})\n"
                 f"       PRESS_PDFTOTEXT must name an executable, not a script")
    except subprocess.CalledProcessError:
        die(f"press: {PDFTOTEXT} could not read {pdf}")
    return out.read_text(encoding="utf-8", errors="replace")


def lines_by_page(xml):
    """[(yMin, yMax, xMin, xMax, text, words)] per page, sorted by yMin. words holds each
    drawn word's box, (xMin, xMax, yMin, yMax)."""
    # Namespaced by poppler; strip it rather than carry a prefix everywhere.
    try:
        root = ET.fromstring(re.sub(r'\sxmlns="[^"]+"', "", xml, count=1))
    except ImportError:
        # Importing ElementTree always succeeds; a Python built without expat fails here,
        # at the first parse, and its traceback would name neither the check nor a remedy.
        # The pass did not run, which is not a page with nothing on it: exit 2, never 0.
        die("press: the line-overlap check needs a python with an XML parser (expat); this one\n"
            "       has none: set PRESS_PYTHON to one that has")
    except ET.ParseError as e:
        # A truncated or non-XML answer means the binary is not producing what
        # -bbox-layout should, which is a tooling fault rather than a document
        # one. Same reasoning as the FileNotFoundError branch above: a bare
        # ParseError traceback names neither the cause nor the remedy.
        die(f"press: {PDFTOTEXT} did not return usable -bbox-layout XML ({e})\n"
                 f"       set PRESS_PDFTOTEXT to poppler's pdftotext if it is not on PATH")
    for page in root.iter("page"):
        rows = []
        for ln in page.iter("line"):
            drawn = [w for w in ln.iter("word") if (w.text or "").strip()]
            if not drawn:
                continue                              # whitespace-only, nothing drawn
            text = " ".join(w.text for w in drawn)
            boxes = [tuple(float(w.get(k)) for k in ("xMin", "xMax", "yMin", "yMax"))
                     for w in drawn]
            rows.append((float(ln.get("yMin")), float(ln.get("yMax")),
                         float(ln.get("xMin")), float(ln.get("xMax")), text, boxes))
        yield sorted(rows, key=lambda r: r[:4])


def collisions(rows):
    for i, (yA0, yA1, xA0, xA1, tA, wA) in enumerate(rows):
        for yB0, yB1, xB0, xB1, tB, wB in rows[i + 1:]:
            # Sorted by yMin, so once a later line starts below this one's
            # bottom, nothing after it can overlap either.
            if yB0 >= yA1:
                break
            # Side by side rather than stacked. Two columns, or a heading and a
            # right-aligned label, legitimately share vertical space — it is only
            # a collision if they also share horizontal space, by more than the
            # same floor.
            #
            # The floor on this axis was left out at first, for want of a case:
            # across the corpus the smallest horizontal overlap among pairs that
            # clear the vertical test is 144.68pt. The case is a footnote marker.
            # poppler gives link-note's raised marker a line of its own, starting
            # where its word's line ends, and the two can meet with 0.000018pt in
            # common, which is rounding, while the marker shares 4.18pt of height
            # with the word. Nothing is drawn on anything, and with no floor here
            # the pair was reported as text on text.
            if min(xA1, xB1) - max(xA0, xB0) <= EPSILON_PT:
                continue
            if min(yA1, yB1) - max(yA0, yB0) <= EPSILON_PT:
                continue
            # The lines' boxes meet; now the words in them must. A line's box spans
            # its gaps, and poppler gives a raised footnote marker a line of its own,
            # so a marker between two words of one line sits inside that line's box,
            # 4.18pt deep, with no glyph touching it. Only words drawn on words are
            # text on text, by the same floor on both axes.
            ov = max((min(a[3], b[3]) - max(a[2], b[2])
                      for a in wA for b in wB
                      if min(a[1], b[1]) - max(a[0], b[0]) > EPSILON_PT), default=0)
            if ov > EPSILON_PT:
                yield ov, tA, tB


def main():
    # A second argument names the PDF in findings, when the one read is a copy of it: check reads
    # a copy with every scan hidden (lib.typ's scan()), and reports against the document's PDF.
    pdf = sys.argv[1]
    name = sys.argv[2] if len(sys.argv) > 2 else pdf
    rc = 0
    with tempfile.TemporaryDirectory() as tmp:
        for n, rows in enumerate(lines_by_page(layout(pdf, tmp)), 1):
            for ov, upper, lower in collisions(rows):
                print(f"press: {name} page {n} prints text on text — {ov:.2f}pt overlap",
                      file=sys.stderr)
                print(f"    upper: {upper[:72]}", file=sys.stderr)
                print(f"    lower: {lower[:72]}", file=sys.stderr)
                rc = 1
    return rc


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:                    # a crash is the pass failing to run, never a finding
        die(f"press: {pathlib.Path(sys.argv[0]).name} failed: {e!r}")
