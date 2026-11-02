// A résumé, from press's résumé template. It imports press and applies resume(), which sets the
// page, the type and the head; the rest is placeholder for your own. Use it as it is, apply your
// repository's own template that wraps resume(), or copy resume() into your repository and
// change your copy: press prefers none of them.
//
//   sh third_party/press/tools/new.sh docs/<name> resume    (or `just new docs/<name> resume`)
//
// copies it to docs/<name>/main.typ, with the import below rewritten to where press sits.
// In press's own tree the import is relative, ../lib.typ, so the starter compiles there.
//
// What only you can supply, a name, a date, an address, is marked unsourced(): it prints in
// red, and every build says how many are left until each is replaced. The rest is an example to
// rewrite.
//
// ---------------------------------------------------------------------------
// What a résumé here does:
//
//   1. A PARSER READS IT FIRST. One column of real text: a section is a heading, a role an
//      entry(), read in the order they print. No chips, and nothing side by side, which a
//      parser reads out of order. `pdftotext -layout <pdf> -` shows what one sees.
//   2. THE HEAD IS WHO, WHAT AND HOW TO REACH YOU. The name is the document's author, the
//      headline says what you do, and the contact line how to reach you.
//   3. EACH ROLE LEADS WITH WHAT CAME OF IT. A bullet says what you did and the result,
//      the strongest first.
//   4. ITS TYPE IS ONE SIZE. `size:` sets the body, and the head and headings follow it.
//
// Delete the sections a résumé does not use. To send a letter with it, pass the letter the
// same face (face: face-sans, here and there), and centre both heads (centred: true).
// ---------------------------------------------------------------------------

#import "../lib.typ": *

#show: resume.with(
  title: unsourced[Your Name — Résumé],
  author: "Your Name",
  headline: [What you do, in a few words],
  contact: (unsourced[Town, ST], unsourced[555-0100], unsourced(link("mailto:you@example.com"))),
)

= Summary

Two or three sentences: what you do, for whom, and the one thing a reader should remember.

= Experience

#entry([Your role], [Organisation], [2021 – present])
- What you did, and what came of it: a number where there is one.
- The next strongest thing, in a line.

#entry([An earlier role], [Organisation, Town, ST], [2017 – 2021], stacked: true)
- What you did there that the role you want needs.

= Skills

*Area:* the tools and methods, as a reader would search for them.

= Education

#entry([Certificate or degree], [School], [2016])
