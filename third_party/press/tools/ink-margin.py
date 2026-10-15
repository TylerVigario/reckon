#!/usr/bin/env python3
"""Report the smallest distance from any ink to any paper edge, per page.

Exists because a document can overflow the printable area silently: typst has
no concept of a printer's unprintable band, so the failure only appears on
paper, after the sheet is in your hand.

Reads PGM pages by rendering via pdftoppm, so it needs poppler — the same
dependency `check` already has — plus a Python to run this file.

`check` finds that interpreter by EXECUTING a candidate rather than by resolving
the name `python3`, and accepts `python`. On Windows the name proves nothing in
either direction: the App Execution Alias puts a zero-byte `python3` on PATH that
answers `command -v` and then exits 49, and disabling that alias leaves a working
`python` with no `python3` at all. Where neither is found, `check` skips this pass
rather than failing, because the font checks are worth having on their own.

PRESS_PYTHON and PRESS_PDFTOPPM name either executable directly, for the same
reason PRESS_PDFTOTEXT exists: on Windows PATH is not the contributor's to order.
"""
import os, re, subprocess, sys, tempfile, pathlib

def die(msg):
    """The pass could not run: exit 2, apart from 1 for a finding, so check never takes a
    missing or broken tool for a finding a document has accepted."""
    print(msg, file=sys.stderr)
    sys.exit(2)

DPI = 150

# The third poppler binary, and the one PRESS_PDFTOTEXT / PRESS_PDFFONTS forgot.
# Same reasoning as those two: on Windows a contributor cannot order PATH, so the
# lever has to be the executable's name. Unlike the other two this is an ABSENCE
# problem rather than a wrong-implementation one — Git for Windows bundles Xpdf's
# pdftotext but no pdftoppm at all — so there is nothing to assert against, only
# something to find.
PDFTOPPM = os.environ.get("PRESS_PDFTOPPM") or "pdftoppm"

# Pages are rendered BATCH at a time and each raster is deleted once measured, so the
# temporary space stays flat: at 150 dpi a Letter page is about 2 MB, and rendering a
# 300-page book in one call took over 600 MB before the first page was looked at.
BATCH = 25

def page_count(pdf):
    """The root page tree's /Count, as report.sh reads it; None if it cannot be found."""
    counts = re.findall(rb"/Type\s*/Pages\s*/Count\s*(\d+)", pathlib.Path(pdf).read_bytes())
    return max(int(c) for c in counts) if counts else None

def render(pdf, tmp, first=None, last=None):
    """Render pages first..last (all of them without a range) to tmp, in page order."""
    span = ["-f", str(first), "-l", str(last)] if first else []
    try:
        subprocess.run([PDFTOPPM, "-r", str(DPI), "-gray", *span, pdf, f"{tmp}/p"],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        # Without this the failure is a bare Python traceback ending in
        # "[WinError 2] The system cannot find the file specified", which names
        # neither the missing tool nor the remedy.
        die(f"press: printable-area check needs poppler; {PDFTOPPM} not found\n"
                 f"       set PRESS_PDFTOPPM to poppler's binary if it is not on PATH")
    except OSError as e:
        # Found but not runnable, as line-overlap.py handles for PRESS_PDFTOTEXT: on
        # Windows a script raises WinError 193, and the bare traceback names CreateProcess
        # instead of the variable that caused it.
        die(f"press: {PDFTOPPM} could not be run ({e})\n"
                 f"       PRESS_PDFTOPPM must name an executable, not a script")
    except subprocess.CalledProcessError:
        die(f"press: {PDFTOPPM} could not render {pdf}")
    # pdftoppm numbers files by page, padded to the document's page count.
    return sorted(pathlib.Path(tmp).glob("p-*.pgm"),
                  key=lambda f: int(re.search(r"(\d+)\.pgm$", f.name).group(1)))

def pages(pdf, tmp):
    """(page number, raster) for every page, each raster removed once the caller is done."""
    count = page_count(pdf)
    spans = ([(a, min(a + BATCH - 1, count)) for a in range(1, count + 1, BATCH)]
             if count else [(None, None)])
    for first, last in spans:
        for f in render(pdf, tmp, first, last):
            yield int(re.search(r"(\d+)\.pgm$", f.name).group(1)), f
            f.unlink()

def read_pgm(path):
    d = path.read_bytes()
    fields, i = [], 0
    while len(fields) < 4:
        while d[i:i+1].isspace(): i += 1
        if d[i:i+1] == b"#":
            while d[i:i+1] not in (b"\n", b""): i += 1
            continue
        j = i
        while not d[j:j+1].isspace(): j += 1
        fields.append(d[i:j]); i = j
    return int(fields[1]), int(fields[2]), d[i+1:]

def clearance(path):
    w, h, px = read_pgm(path)
    minx, maxx, miny, maxy = w, -1, h, -1
    for y in range(h):
        row = px[y*w:(y+1)*w]
        # 230 rather than 255: anti-aliased edges and the palest tints are ink.
        xs = [x for x, v in enumerate(row) if v < 230]
        if xs:
            miny = min(miny, y); maxy = y
            minx = min(minx, xs[0]); maxx = max(maxx, xs[-1])
    if maxx < 0:
        return None                      # blank page, nothing to clip
    return min(minx, w-1-maxx, miny, h-1-maxy) / DPI

def main():
    # A third argument names the PDF in findings, when the one read is a copy of it: check reads
    # a copy with every scan hidden (lib.typ's scan()), and reports against the document's PDF.
    pdf, floor = sys.argv[1], float(sys.argv[2])
    name = sys.argv[3] if len(sys.argv) > 3 else pdf
    rc = 0
    with tempfile.TemporaryDirectory() as tmp:
        for n, page in pages(pdf, tmp):
            c = clearance(page)
            if c is None:
                continue
            if c < floor:
                print(f"press: {name} page {n} has ink {c:.2f}in from a paper edge "
                      f"(floor {floor:.2f}in) — it will clip when printed at actual size",
                      file=sys.stderr)
                rc = 1
    return rc

if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:                    # a crash is the pass failing to run, never a finding
        die(f"press: {pathlib.Path(sys.argv[0]).name} failed: {e!r}")
