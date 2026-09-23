// The reckon schema, as a printed reference.
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
  Thirty-eight tables across seven clusters. The eight `.drawio` files in
  `docs/schema/` carry the relationships; `docs/decisions.md` carries the
  decisions, verbatim, and is the authority. A table drawn in more than one
  cluster is listed once, under the first.
]

#v(10pt)
#columns(2, gutter: 16pt)[
#colbreak(weak: true)
#band[Who and where]
#v(5pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[entity]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*UK*], [slug], [text · in the URL],
    [], [name], [text],
    [], [terms\_days], [int],
    [], [payment\_method], [text],
    [], [opening\_balance], [numeric],
    [], [tax\_exempt], [bool],
    [], [exemption\_certificate], [text],
    [], [exemption\_expires\_on], [date],
    [], [active], [bool],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[site]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [entity\_id], [uuid · one client],
    [*UK*], [slug], [text · in the URL, per client],
    [], [label], [text · this client's name for it],
    [], [display], [text · generated],
    [], [street], [text],
    [], [city], [text],
    [], [region], [text],
    [], [postcode], [text],
    [], [google\_place\_id], [text],
    [], [address\_verified\_on], [date],
    [], [area\_verified\_on], [date · last asked, NOT NULL],
    [], [tax\_area\_code], [text · CDTFA TAC, NOT NULL],
    [], [tax\_jurisdiction], [text · CDTFA's name, NOT NULL],
    [], [tax\_rate\_pct], [numeric · CDTFA's rate, NOT NULL],
    [], [state\_rate\_pct], [numeric · the state's share],
    [], [district\_rate\_pct], [numeric · the districts on top],
    [], [round\_trip\_miles], [numeric],
    [], [drive\_minutes], [int],
    [], [active], [bool],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[contact]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [name], [text],
    [], [email], [text],
    [], [phone], [text],
    [], [note], [text],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[entity\_contact]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*FK*], [entity\_id], [uuid],
    [*FK*], [contact\_id], [uuid],
    [], [is\_primary], [bool],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[site\_contact]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*FK*], [site\_id], [uuid],
    [*FK*], [entity\_id], [uuid · carried],
    [*FK*], [contact\_id], [uuid],
    [], [is\_primary], [bool],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[site\_tax\_check]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [site\_id], [uuid],
    [], [checked\_at], [timestamptz],
    [], [tax\_area\_code], [text · CDTFA TAC],
    [], [tax\_jurisdiction], [text],
    [], [rate\_pct], [numeric],
    [], [state\_rate\_pct], [numeric],
    [], [district\_rate\_pct], [numeric],
    [], [changed], [bool],
    [], [note], [text],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[tax\_remittance]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [period\_start], [date],
    [], [period\_end], [date],
    [], [filed\_on], [date],
    [], [paid\_on], [date],
    [], [amount], [numeric],
    [], [reference], [text],
    [*FK*], [created\_by], [uuid],
    [], [note], [text],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#callout(tone: "note")["wild jacks is completely seperate. only shared infra" — 18 Aug. One building can host two businesses and one person can act for several clients, so both joins are many-to-many.  "tax screen shouldnt be a thing. it should just be rates pulled in per site via api, regularly updated as to not fall behind. there is no rate that is app managed anymore" — 20 Sep. There is no pool of levies and no screen to curate one: a site carries the rate CDTFA’s API returned for its address, their name for the area and their TAC, and the day it was asked. site\_tax\_check keeps every answer, so a rate that moved can be explained against the invoices billed at the old one. A second copy of a published rate is a rate that goes stale without telling anyone, which is how every address ended up at the operator’s own 7.975%.  "there has to be a way to programmatically figure out the state wide rate. this application connects to beancount thus needs a way to track tax obligations" — 20 Sep. CDTFA’s published rate layer carries StateRate, CountyRate and CityRate beside the total, keyed by the same TAC the rate API returns — StateRate has ONE distinct value across all 558 Californian jurisdictions, so the statewide rate is read rather than assumed, and State+County+City = RATE on every record. That split is what lets tax collected post to the right obligation: it is not income, it is somebody else’s money held briefly. tax\_remittance records what was actually handed over, because no invoice knows that. County and city fold into one district share — "the rate should be listed as state + district" — because CDTFA-105 is a list of districts and names no other kind.  "All sites should have API retrieved rates, there should never be a situation in which they have not" — 20 Sep. So the address and the answer are NOT NULL together: the API wants street, city AND zip and refuses without all three, and a place that cannot be priced cannot be billed from — which makes it not a site. Creating one is a lookup, not a form that can be half-filled.  "each site should be able to have its own contact or be null to fall back on the client contact" — 9 Sep, and "contact should be per client and per site" — 14 Sep. A person is shared: one contact acts for several clients, which is why contact has no owner. What is per client is entity\_contact, and what is per site is site\_contact — several people at a site, one of them answering first, and a site naming nobody falling back to the client’s primary. site\_contact carries the client so two foreign keys can agree: the site is that client’s and the person is that client’s contact.  "Bravo Farms is a client, and the sites are Traver, Kettleman, etc" — 9 Sep. A site belongs to exactly one client; two clients at one address are two sites.]
#v(4pt)

#v(6pt)

#colbreak(weak: true)
#band[What you sell]
#v(5pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[service]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [code], [text],
    [], [name], [text],
    [], [unit], [hour | mile | each],
    [], [taxable], [bool],
    [], [time\_tracked], [bool],
    [], [bill\_to\_nearest\_seconds], [int · time only, null = exact],
    [], [minimum\_charge], [numeric · null = none],
    [], [subscription\_basis], [none|capped|unlimited],
    [], [subscription\_hours], [numeric · capped only],
    [], [subscription\_period], [week|month|quarter|year],
    [], [subscription\_overage], [bill|no\_charge|deny],
    [], [active], [bool],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[service\_price]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [service\_id], [uuid],
    [*FK*], [entity\_id], [uuid · null = every client],
    [], [rate], [numeric · the first person],
    [], [additional\_rate], [numeric · each one after],
    [], [effective\_from], [date],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[pay\_rule]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [service\_id], [uuid],
    [*FK*], [role\_id], [uuid · a role, or],
    [*FK*], [user\_id], [uuid · one person],
    [*FK*], [entity\_id], [uuid · null = every client],
    [], [pays\_for], [time | vehicle],
    [], [method], [per\_hour|percent|fixed|nothing],
    [], [amount], [numeric · none for nothing],
    [], [effective\_from], [date],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[role]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*UK*], [name], [text · the operator's word],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[material]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [sku], [text],
    [], [name], [text],
    [], [brand], [text],
    [], [unit], [each | foot],
    [], [markup\_pct], [numeric],
    [], [taxable], [bool],
    [], [reorder\_level], [numeric],
    [], [active], [bool],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[material\_lot]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [material\_id], [uuid],
    [], [received\_on], [date],
    [], [supplier], [text],
    [], [document\_ref], [text],
    [], [qty\_received], [numeric],
    [], [qty\_remaining], [numeric],
    [], [ex\_tax\_cost\_per\_unit], [numeric],
    [], [tax\_paid\_per\_unit], [numeric],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[material\_price]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [material\_id], [uuid],
    [], [price], [numeric],
    [], [effective\_from], [date],
  )
]
#v(7pt)

#callout(tone: "note")["the services should be universal in nature but allow for our specific requirements, not set in stone" — 23 Sep. A service is configured, not categorised: what it is charged per, how finely, at least what, and whom it pays.  On site: \$80.00 one person, \$130.00 both — 2 Sep. A price counts heads: rate is the first person and additional\_rate each one after, so \$80 and +\$50 is the \$130. Nothing extra per head prices the job; the two equal prices the person.  "gauranteed payments only work for people who have actually worked. that would mean a service is configured per user and per user level (partner, employee, etc) and payouts happens at a unit measurement (per hour but granular down to the minute/second) but also could be a percentage payout of the entire charge" — 23 Sep. pay\_rule is that: a role or one person, for their time or their vehicle, per hour, a percentage of the line, a fixed amount, or nothing. The narrowest rule that has started pays: one client's before every client's, one person's before their role's.  "personal mileage is 100% but company mileage would be 0% payout regardless who drove" — 23 Sep. A vehicle rule pays whoever owns the vehicle, so a company vehicle pays nobody.  "yes each can be a service charge, thats what allows flat rates as you pointed out per service item" — 23 Sep. unit each charges per entry, whatever its length.  "the interim solution should be a time-based toggle per service item that causes it to show/hide from the time service drop down" — 9 Sep. unit is how it is charged; time\_tracked is whether time is captured against it. Mileage may be timed and still billed per mile.  "Remote support settings should be a function of a service item" — 11 Sep. subscription\_hours and subscription\_overage are the terms coverage starts from; "the default remote support is 2 hours" — 9 Sep is one of them. Empty means not sold as a subscription, which is NOT what empty means on agreement\_service.included\_hours, where it means unlimited.  [claude] bill\_to\_nearest\_seconds and minimum\_charge were proposed, not asked for: the usual next question about an hourly price. Pay is never rounded to them; it is counted as worked.  [claude] material\_lot is where stock enters, and where the Reg 1701 ex-tax purchase price is sourced. Weighted-average cost needs lots to average.]
#v(4pt)

#v(6pt)

#colbreak(weak: true)
#band[Work as it is captured]
#v(5pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[time\_entry]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*UK*], [client\_uuid], [uuid · from the phone],
    [], [worked\_on], [date],
    [], [minutes], [int],
    [], [crew], [one | team],
    [*FK*], [worked\_by], [uuid · null when team],
    [*FK*], [created\_by], [uuid · ran the timer],
    [*FK*], [entity\_id], [uuid · null = internal],
    [*FK*], [site\_id], [uuid],
    [*FK*], [service\_id], [uuid],
    [], [billable], [bool],
    [], [note], [text],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[trip]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [travelled\_on], [date],
    [*FK*], [driven\_by], [uuid],
    [*FK*], [created\_by], [uuid],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[trip\_stop]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [trip\_id], [uuid],
    [], [seq], [int],
    [*FK*], [site\_id], [uuid],
    [], [arrived\_at], [timestamptz],
    [], [departed\_at], [timestamptz],
    [], [address], [text · somewhere that is nobody's site],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[trip\_leg]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [trip\_id], [uuid],
    [], [seq], [int],
    [], [miles], [numeric],
    [*FK*], [entity\_id], [uuid · who caused it],
    [*FK*], [site\_id], [uuid],
    [*FK*], [service\_id], [uuid · what it bills as],
    [], [rule], [text],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[app\_user]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [name], [text],
    [*UK*], [email], [text],
    [], [credential], [text · argon2id],
    [], [active], [bool],
    [*FK*], [role\_id], [uuid · null = not paid],
    [], [failed\_attempts], [int],
    [], [locked\_until], [timestamptz],
    [], [last\_seen\_at], [timestamptz],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#callout(tone: "note")["there is only he creates or i do" — 3 Sep. worked\_by is paid for the hour and sets whether it bills at \$80 or \$130; created\_by is how the row is explained later.  "he is a full partner after all and can have his own clients and very much so is responsible for tracking his own time worked" — 18 Aug.  [claude] client\_uuid is made on the phone: the offline queue retries, and without it a retry that timed out enters the hour twice.  "wouldnt it just be simpler to log hours as both which get split at partner pay out time?" — 9 Sep. A team job is ONE entry carrying crew = team, so the billable quantity is stored rather than derived. If one stays on, that is a second entry at crew = one.  "worked\_by sounds misleading now" and "both should mean team" — 9 Sep. worked\_by is null on a team entry; created\_by ran the timer; app\_user.role\_id says who is paid, and in what capacity.  [claude] Until entries name who worked, a team is everybody who holds a role: that is the head count a team entry is priced and paid at.  [claude] trip\_leg.service\_id is what a billed leg bills as. Every screen used to find it by assuming one service is charged per mile.]
#v(4pt)

#v(6pt)

#colbreak(weak: true)
#band[Agreements]
#v(5pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[agreement]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [], [billing\_interval], [weekly|monthly|quarterly|annually],
    [], [billing\_anchor\_day], [1–31 · from starts\_on],
    [], [final\_period\_proration], [none|daily],
    [*FK*], [contact\_id], [uuid · agreed with],
    [*PK*], [id], [uuid],
    [*FK*], [entity\_id], [uuid],
    [], [basis], [flat | per\_location],
    [], [price], [numeric],
    [], [starts\_on], [date],
    [], [ends\_on], [date],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[agreement\_site]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*FK*], [agreement\_id], [uuid],
    [*FK*], [site\_id], [uuid],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[agreement\_period]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [agreement\_id], [uuid],
    [], [period\_start], [date],
    [], [period\_end], [date],
    [], [amount], [numeric · as charged],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[agreement\_service]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [agreement\_id], [uuid],
    [*FK*], [service\_id], [uuid · once per agreement],
    [], [allotment], [capped | unlimited],
    [], [included\_hours], [numeric · capped only],
    [], [allotment\_basis], [flat | per\_location],
    [], [overage], [bill|no\_charge|deny · capped only],
  )
]
#v(7pt)

#callout(tone: "note")["per site and per client. we talked about this. reoccurings should be per site or client." — 18 Aug. One shape: a basis plus the locations it covers.  \$200 a month per site — "It's 200 for Traver and 200 for kettleman. (Per site)" — 2 Sep. Bravo hold two subscriptions, one per main site, and their agreement is unlimited: "\$400 a month for remote support (unlimited)".  "the default remote support is 2 hours" — 9 Sep, which is what a subscription carries otherwise. The pool is "set at the client level vs the site level", so the meter sits here rather than per location.  "allotment used and they call. bill per minute at the going rate. also can be set as no-charge or deny work" — 9 Sep.  "retainer does meter but bravo will show infinite right now" — 18 Aug.  "whats the difference between on-site and remote? why are they categorical instead of universal?" — 23 Sep. The split answered one question, which hours come out of a retainer, and answered it by kind. agreement\_service names the services an agreement covers, each with its own allotment, so an on-site retainer is as easy as a remote one and an hour on a service not named is billed.  [claude] The terms are the agreement's own. They start from the service's subscription terms when coverage is added, and a later change to the service does not reach into an agreement already made.]
#v(4pt)

#v(6pt)

#colbreak(weak: true)
#band[Money out]
#v(5pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[invoice]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*UK*], [number], [text],
    [*FK*], [entity\_id], [uuid],
    [], [status], [draft|sent|paid|void],
    [], [issued\_on], [date],
    [], [due\_on], [date],
    [], [period\_start], [date],
    [], [period\_end], [date],
    [*UK*], [public\_token], [text],
    [], [token\_expires\_on], [date],
    [], [sent\_at], [timestamptz],
    [*FK*], [created\_by], [uuid],
    [], [void\_reason], [text],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[invoice\_line]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [invoice\_id], [uuid],
    [], [seq], [int],
    [], [kind], [service|material|recurring],
    [], [description], [text],
    [], [qty], [numeric],
    [], [unit], [hour|mile|each|foot|month],
    [], [unit\_price], [numeric · as billed],
    [*FK*], [site\_id], [uuid],
    [], [taxable], [bool],
    [], [tax\_rate\_pct], [numeric · as applied],
    [], [tax\_source], [site|override|exempt],
    [], [tax\_override\_reason], [text],
    [], [ex\_tax\_cost], [numeric · snapshot],
    [], [tax\_paid], [numeric · snapshot],
    [], [amount], [numeric],
    [*FK*], [time\_entry\_id], [uuid],
    [*FK*], [trip\_leg\_id], [uuid],
    [*FK*], [agreement\_period\_id], [uuid],
    [*FK*], [material\_lot\_id], [uuid],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[credit\_note]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*UK*], [number], [text],
    [*FK*], [entity\_id], [uuid],
    [], [issued\_on], [date],
    [], [amount], [numeric],
    [], [kind], [reg1700b|correction],
    [], [reason], [text],
    [*FK*], [created\_by], [uuid],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[credit\_application]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [credit\_note\_id], [uuid],
    [*FK*], [invoice\_id], [uuid],
    [], [amount], [numeric],
    [], [applied\_on], [date],
  )
]
#v(7pt)

#callout(tone: "note")["your right i meant per site but can even be overriden as the invoice level" — 3 Sep. The override is stored per line so one invoice can carry lines at two sites; setting it across an invoice writes the column many times.  "the invoicing should be digital with a email/printed counterpart (PDF) and needs to integrate with stripe" — 5 Aug.  [claude] A sent invoice is immutable and a credit note is the only way to change what a client owes. Credits belong to the entity, never to an invoice.  [claude] One provenance FK per line, or none, so the return groups by what produced each line.  "agreed, add unit type" — 9 Sep. unit is what qty counts, frozen at issue like tax\_rate\_pct, so a line reads 41.20 mi \@ \$0.72 without asking the service what it is called today. Null where a quantity names nothing: a flat charge, an adjustment.]
#v(4pt)

#v(6pt)

#colbreak(weak: true)
#band[Money in]
#v(5pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[payment]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [entity\_id], [uuid],
    [], [received\_on], [date],
    [], [gross], [numeric],
    [], [method], [card|transfer|cheque],
    [], [processor\_ref], [text],
    [*FK*], [payout\_id], [uuid · null until it lands],
    [], [created\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[payment\_allocation]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [payment\_id], [uuid],
    [*FK*], [invoice\_id], [uuid],
    [], [amount], [numeric],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[refund]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [payment\_id], [uuid],
    [], [amount], [numeric],
    [], [refunded\_on], [date],
    [], [reason], [text],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[payout]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [processor], [text],
    [], [arrived\_on], [date],
    [], [gross], [numeric],
    [], [fees], [numeric],
    [], [net], [numeric],
    [], [bank\_reference], [text],
  )
]
#v(7pt)

#callout(tone: "note")[[claude] Stripe pays one deposit covering several invoices, net of fees, so a payment knows which payout carried it and the payout knows what the bank shows.  [claude] payment\_allocation carries partial payments, and it is why a refund never makes an invoice look unpaid: the refund reverses the payment, and the invoice is closed by a credit note against the entity.]
#v(4pt)

#v(6pt)

#colbreak(weak: true)
#band[The operator, and the record]
#v(5pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[operator]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [singleton], [bool · one row only],
    [], [trading\_name], [text],
    [], [short\_name], [text],
    [], [logo], [bytea · null → name],
    [], [logo\_media\_type], [text],
    [], [accent\_colour], [text],
    [], [address], [text],
    [], [google\_place\_id], [text · the place it is],
    [], [address\_verified\_on], [date],
    [], [tax\_number], [text],
    [], [tax\_number\_label], [EIN | VAT | ABN],
    [], [email], [text],
    [], [phone], [text],
    [], [currency], [text],
    [], [timezone], [text],
    [], [rounding\_mode], [text],
    [], [tax\_rule\_set], [us\_ca|flat\_per\_site|none],
    [], [invoice\_number\_format], [text],
    [], [next\_invoice\_number], [int],
    [], [default\_terms\_days], [int],
    [], [ageing\_alert\_days], [int],
    [], [default\_markup\_pct], [numeric · 20],
    [], [invoice\_footer], [text],
    [], [auto\_send], [bool],
    [], [email\_attaches\_pdf], [bool],
    [], [email\_includes\_payment\_link], [bool],
    [], [tax\_registration], [text],
    [], [tax\_agency], [text],
    [], [filing\_basis], [annual|quarterly|monthly],
    [], [fiscal\_year\_end\_month], [1–12],
    [], [claims\_tax\_paid\_purchases\_resold], [bool],
    [], [date\_format], [text],
    [], [mileage\_assignment], [actual|round\_trip\_per\_client],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[session]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [token\_hash], [text · sha256],
    [*FK*], [user\_id], [uuid],
    [], [created\_at], [timestamptz],
    [], [expires\_at], [timestamptz],
    [], [last\_used], [timestamptz],
    [], [user\_agent], [text],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[record\_history]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [table\_name], [text],
    [], [row\_id], [uuid],
    [], [field], [text],
    [], [old\_value], [text],
    [], [new\_value], [text],
    [*FK*], [changed\_by], [uuid],
    [], [changed\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[account\_map]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [role], [text · what it is for],
    [], [account], [text · as the ledger names it],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[ledger\_export]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [event], [text],
    [], [source\_table], [text],
    [], [source\_id], [uuid],
    [], [dated\_on], [date],
    [], [exported\_at], [timestamptz],
    [], [transaction\_text], [text],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[integration]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [name], [stripe|beancount|press|email],
    [], [connected], [bool],
    [], [detail], [text · never a key],
    [], [checked\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[migration]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [filename], [text],
    [], [applied\_at], [timestamptz],
  )
]
#v(7pt)

#callout(tone: "note")["the whole platform is universal. user access is the only separation for now. there is no he sees or i see. there is only he creates or i do" — 3 Sep. So app\_user has no permission columns. role\_id is not access: it is the capacity someone is paid in, which pay rules are written against.  [claude] A session is a row, not a signed token: one server, one database, and every page reads it anyway, so a stateless token would save no round trip and cost revocation. Only the SHA-256 of the cookie is stored, so a copy of this table lets nobody in — the same reason credential is a hash.  [claude] migration is the applied-schema record db/apply.sh keeps, so re-running it applies only what a database has not seen.  "it should not detract from an operator supplied logo. we must create a settings page so eevrything required can be operator supplied" — 3 Sep. logo is nullable and the interface renders trading\_name in its place.  [claude] the subscription defaults left in 0017: a business does not have an included-hours figure, a thing it sells does. They are on service now, and what is paid to whoever answers is a dated pay\_rule.  [claude] record\_history is append-only and exists to explain a figure, not to police one.]
#v(4pt)

#v(6pt)

]

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
  [Emergency attendance is unpriced], [],
  [What is open at cutover], [whether any credit, refund or unpaid invoice is still outstanding on the day FreshBooks is retired, and so whether an opening balance is needed at all. Known on the day.],
  [Token lifetime], [on the public invoice link.],
  [The decimal library], [for the application layer.],
  [Three data gaps], [Valley Sky Farms has no address on file, Esmeralda has no district recorded, and Daniel's surname is inferred from his email address rather than confirmed.],
)

#v(12pt)
#stamp[Generated from `docs/schema/`. Change a diagram and regenerate.]
