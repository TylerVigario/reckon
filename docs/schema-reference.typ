// The reckon schema, as a printed reference.
//
// GENERATED from the .drawio files by docs/schema/make-printable.py. Change a
// diagram and regenerate; do not hand-edit this file.
//
// It carries what a diagram cannot: every column of every table, in one
// sequence, readable beside a keyboard. The notes beside each cluster say why
// a table is the shape it is.

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
  `docs/schema/` carry the relationships; the schema's comments carry the reasoning.
  A table drawn in more than one cluster is listed once, under the first.
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

#callout(tone: "note")[One building can host two businesses and one person can act for several clients, so both joins are many-to-many.  A site carries the rate CDTFA’s API returned for its address, their name for the area and their TAC, and the day it was asked; nothing in the application can author a rate. site\_tax\_check keeps every answer, so a rate that moved can be explained against the invoices billed at the old one. A second copy of a published rate goes stale without telling anyone, and is then charged at addresses it was never true for.  CDTFA’s published rate layer carries StateRate, CountyRate and CityRate beside the total, keyed by the same TAC the rate API returns — StateRate is one value for every jurisdiction in the state, so the statewide rate is read rather than assumed, and State+County+City = RATE on every record. That split is what lets tax collected post to the right obligation: it is not income, it is somebody else’s money held briefly. tax\_remittance records what was actually handed over, because no invoice knows that. County and city fold into one district share, because CDTFA-105 is a list of districts and names no other kind.  Every site has a rate from the API, so the address and the answer are NOT NULL together: the lookup takes street, city and postcode or answers nothing, and a place with no rate cannot be billed from — so it is not a site. Creating one is a lookup, not a form that can be half-filled.  A contact is named per client and per site, and a person is shared: one contact acts for several clients, which is why contact has no owner. What is per client is entity\_contact, and what is per site is site\_contact — several people at a site, one of them answering first, and a site naming nobody falling back to the client’s primary. site\_contact carries the client so two foreign keys can agree: the site is that client’s and the person is that client’s contact.  A site belongs to exactly one client; two clients at one address are two sites.]
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
    [], [pays\_for], [time|covered\_time|vehicle],
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

#callout(tone: "note")[A service is configured, not categorised: what it is charged per, how finely, at least what, and whom it pays.  rate is the first person's and additional\_rate each extra person's: at \$120 and +\$70 a crew of three costs \$260 an hour.  Pay is for work done. Each pay\_rule is for a role or for one person, pays for time or a vehicle — hourly to the second, as a share of the line, as a fixed sum, or not at all. Among rules in force, a client's own comes first, then a person's own, then the role's.  A vehicle rule pays whoever owns the vehicle, so a vehicle the business owns pays nobody.  A covered\_time rule pays a percentage of the period's retainer charge, divided by each person's part of the covered time.  unit each charges per entry, whatever its length: a flat rate.  unit is how a service is charged; time\_tracked is whether time is captured against it. Mileage may be timed and still billed per mile.  Allotments live on agreements, service by service, never on the service itself.  bill\_to\_nearest\_seconds and minimum\_charge are the usual next questions about an hourly price. Pay is never rounded to them; it is counted as worked.  material\_lot is where stock enters, and where the Reg 1701 ex-tax purchase price is sourced. Weighted-average cost needs lots to average.]
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
  #text(font: face-mono, size: sz.fine, weight: "bold")[user]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [name], [text],
    [*UK*], [email], [text · lowercase],
    [], [email\_verified], [bool],
    [], [image], [text],
    [*FK*], [role\_id], [uuid · null = not paid],
    [], [active], [bool],
    [], [created\_at], [timestamptz],
    [], [updated\_at], [timestamptz],
  )
]
#v(7pt)

#callout(tone: "note")[worked\_by is who worked the hour, and crew says whether it bills at one person's rate or the team's; created\_by is who entered it, which is how the row is explained later.  client\_uuid is made on the phone: the offline queue retries, and without it a retry that timed out enters the hour twice.  Work done by the whole crew is one row with crew = team, so its billable quantity is recorded, not worked out. Anyone who carries on alone afterwards gets a row of their own at crew = one.  A team row has no worked\_by. created\_by is whoever ran the timer, and user.role\_id is what decides pay.  The team is every active person with a role; that number is the head count a team row is priced and paid at.  trip\_leg.service\_id is what a billed leg bills as, so nothing has to assume that only one service is charged per mile.]
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
    [*FK*], [site\_id], [uuid · null = the whole client],
    [], [price], [numeric · a period],
    [], [starts\_on], [date],
    [], [ends\_on], [date],
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
    [], [given], [bool · charged nothing, on purpose],
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
    [], [overage], [bill|no\_charge|deny · capped only],
  )
]
#v(7pt)

#callout(tone: "note")[With site\_id empty the agreement is the client's; with it set, it is that site's and comes first for work there. A client may hold one of its own, one per site, or both.  No allotment is assumed: each agreement states its own, and the hours are shared by every site the agreement reaches, so the meter belongs to the agreement.  Past the allotment an hour bills at the going rate, to the service's increment, or is not charged, or is refused.  A retainer meters its hours, and an unlimited one shows no cap.  A period is charged when it begins, and can be given: covered, charged nothing, on purpose.  agreement\_service lists what an agreement covers, service by service, each with its own allotment. Any service can be put on a retainer, and one the agreement does not list bills as usual.  A capped pool is drawn in the order hours were worked, within an agreement\_period — a charged period. Hours it covers bill nothing by the hour and are paid as a share of that period's charge.]
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
    [], [kind], [service|material|recurring|adjustment],
    [], [description], [text],
    [], [qty], [numeric],
    [], [unit], [hour|mile|each|foot|month],
    [], [unit\_price], [numeric · as billed],
    [*FK*], [site\_id], [uuid],
    [], [taxable], [bool],
    [], [tax\_rate\_pct], [numeric · as applied],
    [], [tax\_source], [none|site|override|exempt],
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
    [], [kind], [reg1700b|correction|goodwill],
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

#callout(tone: "note")[A tax override is stored per line, so one invoice can carry lines at two sites; setting it across an invoice writes the column many times.  Emailing an invoice, printing it as a PDF and taking card payment through Stripe are planned; none is built yet.  A sent invoice is immutable and a credit note is the only way to change what a client owes. Credits belong to the entity, never to an invoice.  One provenance FK per line, or none, so the return groups by what produced each line.  unit is what qty counts, frozen at issue like tax\_rate\_pct, so a line keeps its unit if the service is later changed. Null when the quantity counts nothing, as on a flat charge or an adjustment.]
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
    [], [method], [card|transfer|cheque|cash|other],
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

#callout(tone: "note")[Stripe pays one deposit covering several invoices, net of fees, so a payment knows which payout carried it and the payout knows what the bank shows.  payment\_allocation carries partial payments, and it is why a refund never makes an invoice look unpaid: the refund reverses the payment, and the invoice is closed by a credit note against the entity.]
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
    [], [default\_markup\_pct], [numeric · 25],
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
    [*PK*], [id], [uuid],
    [*FK*], [user\_id], [uuid],
    [*UK*], [token], [text · signed in the cookie],
    [], [expires\_at], [timestamptz],
    [], [ip\_address], [text],
    [], [user\_agent], [text],
    [], [created\_at], [timestamptz],
    [], [updated\_at], [timestamptz],
  )
]
#v(7pt)

#block(breakable: false)[
  #text(font: face-mono, size: sz.fine, weight: "bold")[account]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [*FK*], [user\_id], [uuid],
    [], [provider\_id], [text · credential = a password],
    [], [account\_id], [text],
    [], [password], [text · argon2id],
    [], [access\_token], [text],
    [], [refresh\_token], [text],
    [], [id\_token], [text],
    [], [access\_token\_expires\_at], [timestamptz],
    [], [refresh\_token\_expires\_at], [timestamptz],
    [], [scope], [text],
    [], [created\_at], [timestamptz],
    [], [updated\_at], [timestamptz],
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
    [*PK*], [id], [bigint],
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
  #text(font: face-mono, size: sz.fine, weight: "bold")[verification]
  #v(3pt)
  #sheet(
    (auto, auto, 1fr),
    ([], [Column], [Type]),
    size: sz.micro,
    [*PK*], [id], [uuid],
    [], [identifier], [text],
    [], [value], [text],
    [], [expires\_at], [timestamptz],
    [], [created\_at], [timestamptz],
    [], [updated\_at], [timestamptz],
  )
]
#v(7pt)

#callout(tone: "note")[Anyone who can sign in can see and change everything: user has no permission columns. role\_id is not access: it is the capacity someone is paid in, which pay rules are written against.  user, session, account and verification are Better Auth's, in its shape. A password is an account whose provider\_id is credential, and what it holds is an argon2id hash. There is no sign-up: people are added from the command line.  A session is a row, not a stateless token: one server, one database, and every page reads it anyway, so a stateless token would save no round trip and cost revocation. The cookie is the token signed with the server's secret, so a copy of this table lets nobody in without the secret as well.  Which migrations a database has seen is Drizzle's record, in drizzle.\_\_drizzle\_migrations, so re-running db/apply.sh applies only what is new.  Everything that identifies the business is the operator's to supply: logo is nullable and the interface renders trading\_name in its place.  An included-hours figure is a client's, on their agreement, and what is paid to whoever answers is a dated pay\_rule.  record\_history is append-only and exists to explain a figure, not to police one.]
#v(4pt)

#v(6pt)

]

#pagebreak()

#band[What the database refuses]
#v(5pt)

#text(size: sz.fine)[
  Where the database can hold a rule rather than trusting the application to
  remember it, it does. Each of these is a constraint or a trigger in the
  schema, not a check the application has to remember.
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
  [A payout whose net ignores the fee], [`net = gross - fees`],
  [Two prices for one service, client and day], [one price per day],
)

#v(12pt)
#stamp[Generated from `docs/schema/`. Change a diagram and regenerate.]
