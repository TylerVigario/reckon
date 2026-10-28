// The résumé template, and the part only a résumé uses.
// A template is composed from tokens, parts and composition, and never from another template, so
// it can be read, or copied, on its own.

#import "tokens.typ": *
#import "parts.typ": *

// --------------------------------------------------------------- résumés ---
// A résumé is read first by an applicant-tracking parser, which takes its text in the order the
// page gives it, and then by a person. So it keeps to one column: a section is a heading, and a
// role is one paragraph, read in the order it is printed.

// One role: the role in bold, the organisation after it, and the dates at the right of the line,
// in one paragraph, so a parser reads the three in that order and a role too long for one line
// carries its dates on its last. `stacked` puts the organisation on a line of its own, under the
// role and its dates, for organisations that carry a place. A page never ends on a role: the
// entry stays with what follows it.
//
//   #entry([Network technician], [Valley Broadband], [2021 – present])
#let entry(role, org, dates, stacked: false) = block(width: 100%, above: 1em, sticky: true, {
  // The dates, pushed right. Joined to an empty box, so dates that do not fit on the line go to
  // the next one whole and still at the right: a line drops space that starts it, not a box.
  let when = [#box(width: 0pt)#sym.wj#h(1fr)#sym.wj#box(text(fill: ink-soft, dates))]
  if stacked {
    [#strong(role) #when \ #org]
  } else {
    [#strong(role) — #org #when]
  }
})


// A résumé: one column on a full sheet, with no footer. The head is the writer's name, from the
// document's author, with the headline and a line of contact details under it; `centred` centres
// it, and a letter that goes with it passes centred: true and the same face. A section is a
// heading, `= Experience`, in the accent and ruled beneath, and a role is an entry(). `size` is
// the body text, and the head and headings are sized from it. `caps: false` keeps the headings'
// case, which upper() would change. A set rule after the show rule changes a heading's gaps:
// `#show heading: set block(above: 8pt)` for the space above, `below:` for the space under the
// rule, and `inset: (bottom: 2pt)` for the space between the title and its rule. `contact` is a
// list of items, or one item alone.
//
//   #show: resume.with(title: [Your Name — Résumé], author: "Your Name",
//     headline: [Network and systems], contact: ([Town, ST], link("mailto:you@example.com")))
#let resume(
  title: none, author: (), headline: none, contact: (), face: face-text, centred: false,
  size: sz.small, accent: slate, caps: true,
  preset: (paper: "us-letter", margin: (x: 0.6in, y: 0.5in)), body,
) = {
  set document(title: title, author: author)
  set page(..preset)
  set text(font: face, size: size, fill: ink, lang: "en")
  set par(leading: 0.52em, spacing: 0.55em)
  set list(indent: 0.65em, body-indent: 0.34em, spacing: 0.32em)
  show link: link-note
  let contact = if type(contact) == array { contact } else { (contact,) }
  show heading: set block(above: 1.1em, below: 0.6em, inset: (bottom: 0.3em),
    stroke: (bottom: 0.5pt + rule-mid), sticky: true)
  show heading: it => block(width: 100%, text(size: 1.1 * size, weight: 700, fill: accent,
    tracking: 0.5pt, if caps { upper(it.body) } else { it.body }))

  // The name's box ends at its descenders, not its baseline, so the gap under it clears a g or
  // a y at any body size.
  let head = block(width: 100%, above: 0pt, below: 1.2em, context stack(spacing: 0.6em,
    text(size: sz.title, weight: 700, bottom-edge: "descender", _writer(what: "a résumé")),
    ..if headline != none { (text(size: 1.1 * size, fill: accent, headline),) },
    ..if contact.len() > 0 {
      (text(size: 0.95 * size, fill: ink-soft, contact.join(text(fill: ink-faint)[ #sym.dot.c ])),)
    },
  ))
  if centred { align(center, head) } else { head }
  body
}
