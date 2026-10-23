// The letter template, and the parts only a letter uses.
// A template is composed from tokens, parts and composition, and never from another template, so
// it can be read, or copied, on its own.

#import "tokens.typ": *
#import "parts.typ": *
#import "composition.typ": *

// --------------------------------------------------------------- letters ---
// A letter's own parts, which template/letter.typ composes and a letter takes as it needs.
// The writer is the document's author, set once with `set document(author: "…")`, and the date
// is written once, with dateline(), where the letter prints it; no part takes either again. The
// date is never the build stamp: a letter is dated the day it goes out, and its reader is
// outside, with no shelf copy to compare.

#let _letter-date = state("press-letter-date", none)


// The writer's name, a line of contact details, and a rule beneath. A contact item is text or
// a link; a link that shows its own address (link("mailto:…"), or link(url)[example.com])
// reads the same on paper as on screen, so link-note adds no footnote to it. `face` sets a
// letter in the face of the résumé it goes with, and align(center, letterhead(…)) centres the
// name and contact line to match a résumé's centred header; the rule stays full width.
#let letterhead(..contact, face: face-text) = block(width: 100%, above: 0pt, below: 22pt, context {
  set text(font: face)
  let items = contact.pos()
  stack(spacing: 7pt,
    text(size: sz.head, weight: 700, fill: ink, _writer()),
    ..if items.len() > 0 {
      (text(size: sz.small, fill: ink-soft, items.join(text(fill: ink-faint)[ #sym.dot.c ])),)
    },
    line(length: 100%, stroke: 0.75pt + rule-mid),
  )
})

// The letter's date, written once, where it prints. continued() reads it from here.
#let dateline(date) = { _letter-date.update(date); date }

// The subject line. Each reference is kept whole, so an account number never breaks across a
// line, and stays text a reader can copy.
#let re(..refs, words: (re: [Re:])) = block(above: 1.2em, below: 1.2em,
  [#text(weight: 700, _words("re", words, "re").re) #refs.pos().map(r => box(r)).join([; ])])

// What goes with the letter, one item to a line, under the singular word for one item and the
// plural for more.
#let enclosures(..items, words: (singular: [Enclosure], plural: [Enclosures])) = {
  let items = items.pos()
  assert(items.len() > 0, message: "enclosures() needs at least one item")
  let w = _words("enclosures", words, "singular", "plural")
  let label = if items.len() == 1 { w.singular } else { w.plural }
  block(above: 2em, breakable: false, {
    text(weight: 700, label)
    pad(left: 1.2em, top: 2pt, items.join(linebreak()))
  })
}

// A header for page two onward: the writer, the date and the page number, so a page parted
// from the first still says whose letter it is. Page one is left to the letterhead.
//
//   #set page(..reading, header: continued())
#let continued(words: (page: [Page])) = context {
  let w = _words("continued", words, "page")
  let n = counter(page).get().first()
  if n > 1 {
    set text(size: sz.fine, fill: ink-soft)
    let date = _letter-date.final()
    grid(columns: (1fr, auto, 1fr), align: (left, center, right),
      _writer(), if date != none { date }, [#w.page #n])
  }
}


// A letter: the reading page, the letterhead, and the date once; page two onward carries
// continued()'s header. The body is the letter from the recipient on, ending with signature()
// and, where it has them, enclosures(). `face` sets the letter, letterhead included, in the
// face of a résumé it goes with, and `centred` centres the letterhead to match a centred head.
// `header` is the header for page two onward: none leaves it out, and continued(words: …)
// gives it other words. `contact` is a list of items, or one item alone.
//
//   #show: letter.with(title: [Letter to the county], author: "Your Name",
//     contact: ([Town, ST], link("mailto:you@example.com")), date: [15 October 2026])
#let letter(
  title: none, author: (), contact: (), date: none, face: face-text, centred: false,
  header: continued(), body,
) = {
  set document(title: title, author: author)
  set page(..reading, header: header)
  set text(font: face, size: sz.body, fill: ink, lang: "en")
  set par(leading: 0.6em, spacing: 1.05em)
  show link: link-note

  let head = letterhead(..if type(contact) == array { contact } else { (contact,) }, face: face)
  if centred { align(center, head) } else { head }
  if date != none { dateline(date); parbreak() }
  body
}
