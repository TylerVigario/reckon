// A letter, from press's letter template. It imports press and applies letter(), which sets the
// page, the letterhead and the date; the rest is placeholder for your own. Use it as it is, apply
// your repository's own template that wraps letter(), or copy letter() into your repository and
// change your copy: press prefers none of them.
//
//   sh third_party/press/tools/new.sh docs/<name> letter    (or `just new docs/<name> letter`)
//
// copies it to docs/<name>/main.typ, with the import below rewritten to where press sits.
// In press's own tree the import is relative, ../lib.typ, so the starter compiles there.
//
// What only you can supply, a name, a date, an address, is marked unsourced(): it prints in
// red, and every build says how many are left until each is replaced. The rest is an example to
// rewrite.
//
// ---------------------------------------------------------------------------
// What a letter here does:
//
//   1. IT NAMES ITS WRITER AND ITS DATE ONCE, to letter(): the writer is the document's
//      author, and the date the day the letter goes out; the letterhead, signature() and the
//      page-two header read them from there. It never prints the build stamp: its reader is
//      outside, with no shelf copy to compare.
//   2. MEAT FIRST. The first paragraph says why you are writing and what you ask for.
//   3. IT PRINTS AND IT UPLOADS. One column of real text, which a reader can copy and
//      software reading a cover letter can parse.
//   4. SIGNED IN INK, OR NOT. Keep signature()'s lines for a letter you print and sign;
//      pass `signed: false` for a typed sign-off on a letter sent as a file.
//
// Delete the parts a letter does not use: re(), enclosures(). To match a résumé, pass its face
// (face: face-sans), and centre the letterhead to match a centred head (centred: true).
// ---------------------------------------------------------------------------

#import "../lib.typ": *

#show: letter.with(
  title: unsourced[Letter to Recipient Name],
  author: "Your Name",
  contact: (
    unsourced[123 Street Name, Town, ST 00000],
    unsourced[(555) 555-0100],
    unsourced(link("mailto:you@example.com")),
  ),
  date: unsourced[15 October 2026],
)

#unsourced[Recipient Name] \
#unsourced[Title] \
#unsourced[Organisation] \
#unsourced[Street Address] \
#unsourced[Town, ST 00000]

#re(unsourced[Account 0000-0000], unsourced[date of service 1 January 2026])

Dear #unsourced[Recipient Name],

The first paragraph says why you are writing and what you are asking for, so a reader who
stops here still knows.

The paragraphs after it give what the request rests on: the facts, in the order the reader
needs them, each with the reference that lets them check it.

The last paragraph says what happens next, and how to reach you.

#signature(closing: [Sincerely,])

#enclosures([First enclosure], [Second enclosure])
