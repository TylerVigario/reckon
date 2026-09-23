// The decisions register, as a printed document.
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

#text(size: sz.small, fill: ink-soft)[Every decision about reckon, in Tyler's words, dated. *Quotes are verbatim.* This file is the authority. The schema, the diagrams, the DDL and the code derive from it. If something is not here, it has not been decided — and the right move is to ask, once, rather than to reason a decision into existence. Anything below marked *#text(fill: warn, weight: 700)[\[claude\]]* is my reading, not his, and is marked so it can be told apart at a glance.]

#v(10pt)
#band[The rates]
#v(4pt)

*On site, one person — \$80.00 an hour.*
#v(4pt)

#callout(tone: "note")[
  _"we should lower the solo rate to 80/hr"_ — 2 Sep 2026
]
#v(4pt)

*On site, both — \$130.00 an hour.*
#v(4pt)

#callout(tone: "note")[
  _"we can do 130/hr for team work actually"_ — 2 Sep 2026
]
#v(4pt)

*Paid to each person who works the hour — \$50.00.*
#v(4pt)

#callout(tone: "note")[
  _"for bravo only its 50 vts payment and 50 gauranteed payment to the person"_ — 2 Sep 2026
]
#v(4pt)

Asked whether both-on-site at Bravo pays \$50 each or Article 4's \$35, he chose *\$50 each*, 2 Sep 2026.
#v(4pt)

*Remote support — \$50.00 an hour.*
#v(4pt)

#callout(tone: "note")[
  _"remote is 50/hr but goes towards the 4 hour remote support allotment"_ — 1 Sep 2026 \
  _"Nick and I agreed to \$400 a month for remote support (unlimited) but staying at \$50/hr"_ — 2 Sep 2026
]
#v(4pt)

*Mileage — \$0.72 a mile.*
#v(4pt)

#callout(tone: "note")[
  _"mileage 0.72/mi is the current service charge rate"_ — 9 Sep 2026
]
#v(4pt)

It is a service charge like any other, so it is a dated price row rather than a settings field.
#v(4pt)

#text(size: sz.small, weight: 700, fill: steel)[Superseded rates, kept so a reader knows which is current]
#v(3pt)

#sheet(
  (auto, 1fr),
  ([\$100/hr on site], [_"the new rate is 100/hr"_ — 1 Sep, lowered to \$80 on 2 Sep]),
  size: sz.fine,
  [\$80/hr for Bravo on site], [_"80/hr for bravo"_ — 1 Sep; the discount later became the universal solo rate],
  [\$35 each for joint work], [_"partner work is 35 per person and 30 for the company"_ — 13 Aug, replaced by a flat \$50 on 2 Sep],
)
#v(5pt)

#band[Remote support]
#v(4pt)

*A subscription is \$200 a month per site.*
#v(4pt)

#callout(tone: "note")[
  _"It's 200 for Traver and 200 for kettleman. (Per site)"_ — 2 Sep 2026
]
#v(4pt)

*A subscription includes 2 hours by default.*
#v(4pt)

#callout(tone: "note")[
  _"the default remote support is 2 hours, 2 hours. bravo has 2x subscriptions, 1 per main site."_ — 9 Sep 2026
]
#v(4pt)

*Bravo is unlimited.*
#v(4pt)

#callout(tone: "note")[
  _"right now the remote support would be unlimited for bravo (nothing gauranteed for responder)"_ — 1 Sep 2026 \
  _"\$400 a month for remote support (unlimited)"_ — 2 Sep 2026
]
#v(4pt)

Bravo hold *two subscriptions, one per main site* — Traver and Kettleman — which is what makes \$400 out of \$200. Their agreement is unlimited; the two-hour default is what a subscription carries otherwise.
#v(4pt)

*A Bravo call carries no guaranteed payment.* Away from Bravo, \$25 of each remote hour goes to whoever answered and \$25 stays with the business.
#v(4pt)

#callout(tone: "note")[
  _"25 gauranteed for the responder and 25 for vts with a 4 hour cap for anyone else"_ — 1 Sep 2026
]
#v(4pt)

*Remote support is a normal service charge, and the allotment is pre-paid hours against it.*
#v(4pt)

#callout(tone: "note")[
  _"remote hours is a normal service charge but clients can have a pre-paid allotment of it (2 hours, etc) which and the allotment can be set per-site or per-client"_ — 9 Sep 2026
]
#v(4pt)

So the allotment carries its own basis, which need not match how the money is charged — Bravo are billed per site. Hours used are derived from the entries that drew them; what was _charged_ stays stored, because a charge is fixed once made.
#v(4pt)

*Past the allotment: bill per minute at the going rate. It may instead be set to no-charge, or to deny the work.*
#v(4pt)

#callout(tone: "note")[
  _"allotment used and they call. bill per minute at the going rate. also can be set as \\"no-charge\\" or \\"deny work\\""_ — 9 Sep 2026
]
#v(4pt)

*A client with no subscription has nothing included* and is billed from the first minute. Asked directly, 9 Sep 2026.
#v(4pt)

*The pool is set at the client level, not the site level*, so hours at one site draw on another's share. Asked directly, 9 Sep 2026:
#v(4pt)

#callout(tone: "note")[
  _"pooled because its set at the client level vs the site level"_
]
#v(4pt)

*The retainer meters whether or not there is a limit.*
#v(4pt)

#callout(tone: "note")[
  _"retainer does meter but bravo will show infinite right now. its preperation for honest tellings to when it does matter"_ — 18 Aug 2026
]
#v(4pt)

*Team work is one entry, not two.*
#v(4pt)

#callout(tone: "note")[
  _"wouldnt it just be simpler to log hours as both which get split at partner pay out time? that way there is no descrepency? then if one works longer he just adds an additional timer for himself?"_ — 9 Sep 2026
]
#v(4pt)

So an entry carries `crew` — `one` or `team` — and the billable quantity is stored rather than derived. If one of them stays on, that is a second entry at `one`.
#v(4pt)

*A team entry names nobody.*
#v(4pt)

#callout(tone: "note")[
  _"worked\_by sounds misleading now"_ — 9 Sep 2026 \
  _"both should mean team, yes"_ — 9 Sep 2026
]
#v(4pt)

`worked_by` is null on a team entry, because both worked it. Who ran the timer is `created_by`. The team is everybody who holds a role (`app_user.role_id`, since 0020), so a login that holds none is not paid for a job.
#v(4pt)

*Whether a service takes a timer is set per service, and is not the same question as how it is charged.*
#v(4pt)

#callout(tone: "note")[
  _"should mileage show up in the timer at all? on one hand it sounds nice to track time spent even if the charge is per/mi and its possible that it becomes a per/hr rate as well. the interim solution should be a time-based toggle per service item that causes it to show/hide from the time service drop down"_ — 9 Sep 2026
]
#v(4pt)

`service.unit` says how it is charged; `service.time_tracked` says whether it appears in the timer. Mileage is charged per mile and may still be timed.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* Nothing decides whether such time bills, because nothing has to: an entry bills at the hourly price for its service, and a service with no hourly price has none to bill at. That is the same refusal that applies everywhere else, and it means _"possible that it becomes a per/hr rate as well"_ is a price row rather than a schema change.
#v(4pt)

*Remoteness belongs to the service.*
#v(4pt)

#callout(tone: "note")[
  _"services are remote by nature not by an additional checkbox"_ — 9 Sep 2026
]
#v(4pt)

So `service.delivery` was `on_site` or `remote`, and remote services drew the remote allotment. *Superseded 23 Sep 2026* — there is no delivery any more; an agreement names the services it covers. See _A service is configured, not categorised_.
#v(4pt)

#band[What the platform is]
#v(4pt)

#callout(tone: "note")[
  _"its a custom invoicing platform so i can stop paying people. its going to integrate with stripe, beancount & press. itll be a time tracking platform as well."_ — 18 Aug 2026
]
#v(4pt)

*It is called `reckon`.* Chosen 3 Sep 2026 from a shortlist, after rejecting a first shortlist drawn from the low-voltage trade:
#v(4pt)

#callout(tone: "note")[
  _"the naming is too related to my line of work and not an open-source webapp"_
]
#v(4pt)

*Nothing about one operator may be a constant in the code.*
#v(4pt)

#callout(tone: "note")[
  _"it should not detract from an operator supplied logo. we must create a settings page so eevrything required can be operator supplied"_ — 3 Sep 2026
]
#v(4pt)

#band[Who uses it]
#v(4pt)

#callout(tone: "note")[
  _"the whole platform is universal. user access is the only separation for now. there is no he sees or i see. there is only he creates or i do"_ — 3 Sep 2026
]
#v(4pt)

#callout(tone: "note")[
  _"yes robin will use it. he is a full partner after all and can have his own clients and very much so is responsible for tracking his own time worked"_ — 18 Aug 2026
]
#v(4pt)

#band[Clients, sites and recurring charges]
#v(4pt)

#callout(tone: "note")[
  _"the site should have a system to define reocurring charges. to track inventory and line items that can be added to an invoice. services and there rates."_ — 18 Aug 2026
]
#v(4pt)

*Recurring charges are per site and per client — both.*
#v(4pt)

#callout(tone: "note")[
  _"per site and per client. we talked about this. reoccurings should be per site or client."_ — 18 Aug 2026 \
  _"in my mind it is per site. 100 to bravo farms kettleman. 100 to bravo farms traver (the shoppe). but per client also makes sense too."_ — 18 Aug 2026
]
#v(4pt)

*Markup is per item, with an operator default.*
#v(4pt)

#callout(tone: "note")[
  _"20% markup is a value per-material/item which can be set and by default will apply to all sellable items/goods"_ — 9 Sep 2026
]
#v(4pt)

`operator.default_markup_pct` is 20; `material.markup_pct` overrides it for one item and is null otherwise.
#v(4pt)

*Wild Jacks is a separate business* that trades inside Bravo's buildings.
#v(4pt)

#callout(tone: "note")[
  _"wild jacks is completely seperate. only shared infra"_ — 18 Aug 2026
]
#v(4pt)

*Do not model the client's own structure.*
#v(4pt)

#callout(tone: "note")[
  _"bravo farms is owned by a single person (halim) however each site is independent and im too inexperienced to understand the legal nuance"_ — 18 Aug 2026 \
  _"visalia is another nuanced location. its both."_ — 18 Aug 2026
]
#v(4pt)

*An invoice line records the unit its quantity counts.*
#v(4pt)

#callout(tone: "note")[
  _"1 - agreed, add unit type"_ — 9 Sep 2026
]
#v(4pt)

`invoice_line.unit` is frozen at issue, the way `tax_rate_pct` is, so a line reads `41.20 mi @ $0.72` for as long as the invoice exists — even if the service is repriced by the hour afterwards. Null where the quantity names nothing: a flat charge, an adjustment.
#v(4pt)

*Shape questions with no answer yet are settled by using it.*
#v(4pt)

#callout(tone: "note")[
  _"its my hope that through real use we can correct any issues that arise"_ — 9 Sep 2026
]
#v(4pt)

So the default is whatever the schema already does, and a real invoice decides the rest.
#v(4pt)

#text(size: sz.small, weight: 700, fill: steel)[Open — how mileage groups on the invoice]
#v(3pt)

A line is a leg today: `invoice_line.trip_leg_id` is `UNIQUE`. A month of driving to Bravo prints every hop.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* Nothing needs deciding before the first invoice. One leg has one location, so a leg-per-line invoice is always right about the district rate, and issued invoices are frozen documents that would never be regrouped — so changing this later changes how new invoices are built and touches nothing already sent. If it is ever grouped, the tax is the thing to watch: a line carries one rate, and Traver at 7.750% and Kettleman at 7.250% cannot share one.
#v(4pt)

*A client is a business. Where it works is a site.*
#v(4pt)

#callout(tone: "note")[
  _"what about client -\> site mapping and input within time?"_ — 9 Sep 2026 \
  _"the current entries are still of the old kind. they have location intertwined with the client when in reality you know how they are seperated"_ — 9 Sep 2026 \
  _"Bravo Farms is a client, and the sites are Traver, Kettleman, etc"_ — 9 Sep 2026
]
#v(4pt)

The FreshBooks names welded the site into the client — _Bravo Farms (Kettleman)_, _The Shoppe at Bravo Farms_, _Wild Jacks (Traver)_. That is the old shape. *Bravo Farms* is one client whose sites are Traver, Kettleman and Visalia; *Wild Jacks* is one client whose sites are Traver, Kettleman and Tulare.
#v(4pt)

Many-to-many runs in *both* directions at once, which is why neither can be assumed: one client holds several sites, and 36005 CA-99 N holds both Bravo Farms and Wild Jacks — _"wild jacks is completely seperate. only shared infra"_.
#v(4pt)

`entity_location` says which sites are a client's own. It is not a restriction on where work may be billed, and no constraint enforces it — see the note below.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* Invoice 0000035 stops being an anomaly under this shape. It was Traver work billed through the Kettleman _client_, which was only strange because the site was inside the client name; as Wild Jacks work at the Traver site it is an ordinary entry. I enforced `entity_location` as a composite foreign key in `0007`, which would have refused it. `0008` drops that and stays in the history so the reason is findable.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* The timer asks for the site rather than taking the client's first, because the site sets the district rate. Their own sites are offered first and every other site below them.
#v(4pt)

*A site may name its own contact; null falls back to the client's.*
#v(4pt)

#callout(tone: "note")[
  _"each site should be able to have its own contact or be null to fall back on the client contact"_ — 9 Sep 2026
]
#v(4pt)

`entity_location.contact_id`, because a building shared by two clients has a different contact for each — Traver is Kristyn for Bravo Farms and Uriel for Wild Jacks. The fallback is `entity_contact.is_primary`, now unique per client.
#v(4pt)

*A client names its own sites, and sees only its own.*
#v(4pt)

#callout(tone: "note")[
  _"shouldnt they each have there own site input independently? \[...\] listing a sites per client as elsewhere with another client is less than simple and clear"_ — 9 Sep 2026
]
#v(4pt)

`entity_location.label` is what that client calls the site, falling back to the address's own label. The `client_site` view resolves both the name and the contact, and the timer offers a client only its own sites — no _elsewhere_ listing somebody else's.
#v(4pt)

*The address stays one row.* `location` is where the district rate and the round-trip mileage live, so Traver held twice is 7.750% recorded twice and free to drift. That is the shape of the 8.045% error. Shared underneath, each client's own on top.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* The _elsewhere_ list was scar tissue from the old model. It existed so invoice 0000035 could be recorded, and 0000035 only needed it because the site used to sit inside the client name. Wild Jacks owns Traver now, so it is simply on their list.
#v(4pt)

*Bravo Farms stays one client for now, though its locations are separate legal entities.*
#v(4pt)

#callout(tone: "note")[
  _"technically Bravo Farms has different legal entities for each location which may split out to seperate clients but for now, it should all be under the bravo farms umbrella"_ — 9 Sep 2026
]
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* Nothing needs building for the split. A site becoming its own client is a new `entity`, its `entity_location` row re-pointed, and work from that day forward raised against it. Invoices already sent keep the entity they were raised on, which is what they should do — they record what happened. The one thing that would make it expensive is putting the site inside the client name again.
#v(4pt)

#text(size: sz.small, weight: 700, fill: steel)[Open — the mapping itself]
#v(3pt)

`docs/internal/client-site-mapping-worksheet.csv` in the vts repo carries the proposed mapping for all nine clients and the questions still on it: whether The Shoppe is Bravo Farms at Traver or its own client, what Visalia being _"both"_ means, whether 33341 and 33300 Bernard Dr are one site or two, and whether Esmeralda is a client at all.
#v(4pt)

#band[Tax]
#v(4pt)

*A tax district is its own thing; a site is in one.*
#v(4pt)

#callout(tone: "note")[
  _"tax districts should be separate from sites but a site should have a district attached which could intuitively derive from its location"_ — 9 Sep 2026
]
#v(4pt)

`tax_district` carries CDTFA's own jurisdiction name, `tax_district_rate` the dated rate, and `location.tax_district_id` says which district an address is in. The district derives from the address by a lookup, but is stored once determined — a lookup is how you find it, not something to re-derive per invoice.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* This is the same argument as one row per address, one level up, and the level CDTFA publishes at. 33341 and 33300 Bernard Dr are two addresses in UNINCORPORATED AREA-KINGS; under a per-address rate that was 7.250% recorded twice and free to drift. A district rate change is now one row. The `site_rate` view resolves today's rate, and a site with no district resolves *nothing* rather than zero — Valley Sky Farms has no address on file, and a missing rate must refuse rather than read as tax-free.
#v(4pt)

*The rate applies to the site, and may be overridden at the invoice.*
#v(4pt)

#callout(tone: "note")[
  _"your right i meant per site but can even be overriden as the invoice level"_ — 3 Sep 2026
]
#v(4pt)

*Tax rules are pluggable.*
#v(4pt)

#callout(tone: "note")[
  _"tax rates should be … pluggable"_ — 3 Sep 2026
]
#v(4pt)

*Rates carry a real effective date.*
#v(4pt)

#callout(tone: "note")[
  _"rates in a csv with a proper effective date (not arbitrary validated at timestamp)"_ — 18 Aug 2026
]
#v(4pt)

District rates, from his own CDTFA lookups, 11–18 Aug 2026:
#v(4pt)

#sheet(
  (auto, 1fr, 1fr),
  ([site], [jurisdiction], [rate]),
  size: sz.fine,
  [36005 CA-99 N, Traver], [Unincorporated Tulare], [7.750%],
  [33341 / 33300 Bernard Dr, Kettleman City], [Unincorporated Kings], [7.250%],
  [500 W Main St, Visalia], [Visalia, Tulare], [8.500%],
  [1691 Retherford St, Tulare], [Tulare], [8.250%],
  [18137 E Vino Ave, Reedley], [Unincorporated Fresno], [7.975%],
  [421 S I St, Madera], [Madera], [8.250%],
)
#v(5pt)

#band[The stack]
#v(4pt)

Recorded 17 Aug 2026 at his instruction, after he rejected a first recommendation:
#v(4pt)

#callout(tone: "note")[
  _"i hate following patterns for the sake of patterns … your whole fucking turn was an ode to a platform that i already learned just because i already learned. speak freely, please!"_ \
  _"python sharing with books is nearly moot. shell out to whatever you want. dont bind the webapp to it … i think you went backwards instead of forwards."_ \
  _"after a little bit of research sveltekit sounds more like me anyways. it gets rid of the virtual dom which i always found difficult and more than necssary"_
]
#v(4pt)

*SvelteKit*, *Postgres* with money as `NUMERIC`, an *offline queue* for time capture, *Typst via press* and *Stripe* server-side.
#v(4pt)

#text(size: sz.small, weight: 700, fill: steel)[How it is deployed was never decided here]
#v(3pt)

An earlier version of this section said the stack was "deployed as *RPM-as-artifact*". Nothing he said supports that. It is not quoted because there is no quote: the only words of his on the subject are these.
#v(4pt)

#callout(tone: "note")[
  _"rpm as a convention is old infrastructure that is no longer used. look not to what was but what will be"_ — 9 Sep 2026 \
  _"i do not like virtualization containers"_ — 9 Sep 2026
]
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* I took the pattern the estate's older applications use, wrote it into the vts requirements record as "the house deployment pattern", and then carried my own summary into this file as though it had been settled. That is the exact failure this register exists to prevent, and the rule at the bottom already says so: a decision enters only with a quote, and if it cannot be quoted it has not been decided. Removed rather than marked superseded — there was nothing to supersede.
#v(4pt)

*How it is run is not this repository's business at all.*
#v(4pt)

#callout(tone: "note")[
  _"host concerns should be host concerns. we dont provide host concerns to the repo as its platform agnostic. just like website"_ — 9 Sep 2026
]
#v(4pt)

Asked to add service units, a reverse-proxy configuration and a fail2ban jail here, he refused them: they describe one machine and this has to run on any of them.
#v(4pt)

#callout(tone: "note")[
  _"i do not rely on cloudflare proxying. its direct access. apache reverse proxy, WAF, SELinux, etc"_ — 9 Sep 2026
]
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* The consequence for the code is narrow and real: every default is a default rather than an assumption. The database is reached over a unix socket because that is where most Linux packages put one, and `PGHOST`, `PGDATABASE` and `DATABASE_URL` each move it. `db/apply.sh` connects the way any Postgres client does and adds nothing of its own, because being the right user is the caller's job. Nothing names a path, a service manager or a distribution.
#v(4pt)

#band[How the work is sequenced]
#v(4pt)

#callout(tone: "note")[
  _"mock is pure static as a pure display of what the shape will look like so i can iterate and give you a real target to do the bulk work, then ill go back over everything you did in bulk to ensure its done properly."_ — 18 Aug 2026
]
#v(4pt)

*Fundamentals before the end goal.* Export to the ledger waits until what the ledger needs is known and the application can record it.
#v(4pt)

#callout(tone: "note")[
  _"we have no idea about beancount export requirements. for example: how will we track service charge for stripe? that must be recorded in the ledger"_ — 23 Sep 2026 \
  _"it would be NICE for it to show within the webapp as well. but the point still remians. why waste time on an end goal matter when the fundamentals still require so much work"_ — 23 Sep 2026
]
#v(4pt)

#band[Publishing]
#v(4pt)

*The repository is public, real names and rates included.*
#v(4pt)

#callout(tone: "note")[
  _"i have nothing to hide. if someone goes looking for it. they shall find it"_ — 9 Sep 2026
]
#v(4pt)

Asked directly whether `docs/decisions.md` should be scrubbed before the repository went public — his rates, what Robin is paid, and the fact that Bravo hold unlimited remote support where other clients are capped at four hours — he chose to publish all of it unchanged.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* Recorded because the alternative is a future reader assuming the client names are an oversight. They are not: a rule with no case behind it is a rule nobody can check, and the cases here are real invoices. `LICENSE-NOTICE.md` draws the line the licence does not — the machinery is granted, the records are reserved. Reserved is not hidden.
#v(4pt)

#band[Settings save themselves, one field at a time]
#v(4pt)

#callout(tone: "note")[
  \*"we should change the saving mechanism to per field auto save with frontend \
  and backend validation"\* — 10 Sep 2026
]
#v(4pt)

A field commits when focus leaves it, or on Enter; a dropdown commits on change. Nothing commits per keystroke: half-typed input is not a value anybody meant, and saving `5591` on the way to a phone number writes three wrong rows before the right one.
#v(4pt)

*One definition of every rule, imported by both sides.* `settings-fields.ts` is the whole vocabulary — what fields exist, what each accepts, and the sentence to say when it does not. The page imports it so a bad value costs no round trip. The endpoint imports it because nothing arriving over the wire has necessarily been through the page. A rule written twice is a rule that disagrees with itself the first time one copy is edited.
#v(4pt)

*The file is never looser than the database.* Where a column carries a CHECK or a NOT NULL, the rule mirrors it exactly — `ageing_alert_days` refuses zero here because the constraint refuses zero there — so anything that gets past the file and is still wrong is refused by Postgres rather than stored. What the file adds is the sentence a person can act on: "must be 1 or more" rather than `operator_next_invoice_number_check`.
#v(4pt)

*Several rules have no constraint to mirror, and that is deliberate.* An email address, a hex colour, a time zone, an invoice number format and a phone number are all `text` to Postgres, because their shape is presentation rather than integrity: a malformed phone number breaks nothing in the database, and a regex in a CHECK becomes a false rejection the first time somebody bills across a border. The database refuses what would corrupt the system; the file refuses what a person plainly did not mean.
#v(4pt)

#text(size: sz.small, weight: 700, fill: steel)[A phone number is checked for shape, not nationality]
#v(3pt)

#callout(tone: "note")[
  _"phone should have some form of validation"_ — 10 Sep 2026
]
#v(4pt)

Kept exactly as typed. `559-900-1400` and `5599001400` are both already in use here, this is the number that prints at the top of an invoice, and normalising either to `+15599001400` would be the validator deciding how the business looks in print.
#v(4pt)

So what is checked is the shape. E.164 caps a number at fifteen digits including the country code, and below about seven there is nothing long enough to dial; between those, anything a person can write down is allowed through. Spaces, brackets, dashes and dots all mean the same number, and refusing one of them teaches nobody anything. An extension is part of what somebody would read out, so `559-900-1400 x12` is a phone number too.
#v(4pt)

Guessing the country from the time zone was available and rejected: it works until the first cross-border client, and there is no country on the operator to ask.
#v(4pt)

*The keys of that object are the allowlist.* A request names a field, and the name is only ever used to look one up; the column written is the object's own key, which is source text. `credential` is not a key, so no request reaches it.
#v(4pt)

*A request may carry more than one field*, because some values only make sense together. The address, the Google place id that identifies it, and the date Google last agreed are one fact — saving the text without the id would leave the row describing a place it no longer points at. Everything in a request is validated before anything is written.
#v(4pt)

*This makes the page need JavaScript.* It already did, for the timers and the queue; what changed is that settings no longer has a form that would post without it. The logo stays a form action — a file is not a field, and there is nothing to save until one is picked.
#v(4pt)

#text(size: sz.small, weight: 700, fill: steel)[The server decides; the page just answers faster]
#v(3pt)

#callout(tone: "note")[
  \*"The server side save should do everything it can to prevent \
  malformed/incorrect values. Client side should match as best it can, and \
  display server side errors cleanly per field"\* — 11 Sep 2026
]
#v(4pt)

The shared file is everything the two sides can agree on, which is most of it. The endpoint then applies what only it can know, and there are four kinds:
#v(4pt)

1. *Values that are not values.* An object where a string belongs is a caller doing something else, and `String()`-ing it stores `[object Object]`. 2. *Characters nobody typed.* Zero-width spaces and soft hyphens arrive by being pasted out of a word processor and are invisible in the field that holds them, so they are stripped rather than refused — "there is an invisible character in your trading name" is not an error anyone can act on. A control character is refused outright; Postgres will not store a NUL anyway. 3. *References to rows.* A base location may have been deactivated since the page was drawn. The foreign key catches one that is gone; nothing but the endpoint catches one that is still there and no longer in use. 4. *What has already happened.* Numbering back over an invoice that has gone out produces two invoices with one number — a problem found by a client rather than by us. The page is never told what has issued, so it cannot ask.
#v(4pt)

*The browser's word about Google is checked with Google.* A place id is asserted by the browser, and an assertion from the browser is the one thing a server may not take at face value, so the endpoint asks Places Details whether the id is a place. It never blocks a save on Google being reachable: a timeout, a missing key or a 429 all mean _unknown_, and the address saves undated. Only a definite "no such place" refuses. That is also what makes `address_verified_on` worth reading — it is set from Google's answer and `current_date`, never from a date the page sent, because when this system last checked is not something a request gets to assert.
#v(4pt)

*Every refusal comes back keyed by field.* A CHECK violation is traced back to its column through the constraint's own name — `operator_ageing_alert_days_check` is about `ageing_alert_days` — so the complaint appears under the box that caused it. The sentence shown is plain; the constraint name goes to the server log, because reaching that path at all means a rule drifted from the column it mirrors, and that is something to fix rather than something to read.
#v(4pt)

*Numbers are bounded by their column, not by policy.* `default_markup_pct` is NUMERIC(7,4), so three digits before the point and four after — refused as a sentence here rather than as an overflow there. Nobody decided a markup may not exceed 999.9999%; the column did.
#v(4pt)

#text(size: sz.small, weight: 700, fill: steel)[The operator's address was a place nobody kept]
#v(3pt)

The settings page read `operator.address_place_id` from the day the field was added, and that column never existed. The id came back undefined every time and the chosen place was discarded on save, so "all addresses come from Google" was true of every location and of nothing else. `0016` gives the operator the same two columns `0015` gave a location, under the same name.
#v(4pt)

#band[Subscription terms belong to the service that is sold]
#v(4pt)

#callout(tone: "note")[
  _"Remote support settings should be a function of a service item"_ — 11 Sep 2026
]
#v(4pt)

Three columns sat on `operator` describing remote support: how many hours a subscription includes, what is paid to whoever answers, and what happens once the allotment is used. They described one service from the row that describes the business — the same mistake `0012` corrected when remoteness moved off a `time_entry` checkbox and onto the service, and the same one guard 14 is named for. *A business does not have an included-hours figure. A thing it sells does.*
#v(4pt)

The move splits three ways, because the three were never one kind of fact:
#v(4pt)

#list([*`subscription_hours` and `subscription_overage` are terms of sale.* They go])
#v(4pt)

on the service, beside `time_tracked`, which is also a statement about what the thing _is_ rather than about what it costs.
#v(4pt)

#list([*The responder rate was pay, and pay already had a home.* `person_pay_rate`])
#v(4pt)

was (service, date) → rate, so "paid to whoever answers a remote call" was a row in it and always had been. A second copy on `operator` meant two answers to one question, and the undated one would have won by being easier to reach. Since 0020 that home is `pay_rule`.
#v(4pt)

*Empty means something different here than on an agreement.* On `agreement_service.included_hours` (`agreement.remote_cap_hours` before 0020), empty means _unlimited_ — Bravo's two subscriptions carry no cap. On `service.subscription_hours`, empty means _this service is not sold as a subscription at all_. The two are set together or neither is, so no row offers a rule for exceeding an allotment that does not exist.
#v(4pt)

#text(size: sz.small, weight: 700, fill: steel)[The pair travels together, or the state is unreachable]
#v(3pt)

Per-field saving plus a two-column constraint makes a state nobody can get to: from "not sold as a subscription" there is no single field you can set, because hours alone has no rule and a rule alone has no hours. So the two save as one request whichever was touched, and the message in between says what is still missing rather than refusing forever. Same reasoning as the address and its Google place id: some values only make sense together, which is why the endpoints take a set rather than a field.
#v(4pt)

#text(size: sz.small, weight: 700, fill: steel)[What this does not do]
#v(3pt)

*There is still no way to create a service.* The settings page can edit the terms of services that exist and says so plainly when there are none, which is what a fresh install sees — production has zero services today and no screen that makes one. Hiding the section would only make the gap harder to see.
#v(4pt)

*A pay rate has no editor.* It is dated, so changing one appends a row rather than overwriting today's figure, and that is a different interaction from a field that saves itself. The current rate is shown and labelled as read-only.
#v(4pt)

#band[The schema was folded into one file]
#v(4pt)

#callout(tone: "note")[
  _"Consolidate to a single migration. Remote is wiped."_ — 12 Sep 2026
]
#v(4pt)

Twenty-two migrations became `db/migrations/0001_the_schema.sql`, verified by building a database from it and diffing against the one the migrations had produced: byte-identical, and the guard suite passes against a database built only from the folded file.
#v(4pt)

*Numbers cited below — `0007`, `0012`, `0015` — no longer name files.* They name changes, and the reasoning they carried is here, in the schema file's comments, and in the guards. That is deliberate: a reason that only survives in a migration is a reason nobody reads, because the only thing that ever opens a migration again is `psql`.
#v(4pt)

Folding was available only because nothing had been released and the remote had been wiped. After a release, a schema somebody else is running cannot be rewritten under them, and a change becomes a migration that is added and never edited. `CONTRIBUTING.md` says so.
#v(4pt)

#band[Leaving FreshBooks, and a ledger of the partnership's own]
#v(4pt)

*Nothing is carried over from FreshBooks.*
#v(4pt)

#callout(tone: "note")[
  _"this application is forward looking. robin is now a partner. once this application is done we will export freshbooks one last time for this years filing and retire freshbooks completely. there is almost no need to keep historic data from freshbooks in this system and only complicates matters."_ — 23 Sep 2026
]
#v(4pt)

*The application writes to a new ledger, the partnership's, and never to the one that exists today.*
#v(4pt)

#callout(tone: "note")[
  _"the ledger will be creaed anew once we finish the app as well. the current ledger should not be connected or written to with this application. the old ledger is sole prop, the new ledger and this application will be under the partner ein"_ — 23 Sep 2026
]
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* There was a ledger poster, written against the sole proprietorship's ledger: its usage pointed there and its default account names were that ledger's chart. It has been removed rather than corrected — see _How the work is sequenced_. It never posted anything there; none of its transaction markers appear in that ledger or anywhere in its history.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* _"almost no need"_ leaves one exception: whatever is still open on the day — an unapplied credit, a refund owed, an invoice not yet paid. That is a balance a client can still draw on rather than history, and `entity.opening_balance` was reserved for it in 0018.
#v(4pt)

#band[A service is configured, not categorised]
#v(4pt)

#callout(tone: "note")[
  _"weve paid too much attention to my specific requirements for services which makes it less universal. the services should be universal in nature but allow for our specific requirements, not set in stone. what type of configuration per service is required to meet all our criteria (i.e. rate to customer, static payout rate per person, percentage payout rate per person, fixed person payout, etc)?"_ — 23 Sep 2026
]
#v(4pt)

*Pay is a set of rules, per person and per role, not one rate.*
#v(4pt)

#callout(tone: "note")[
  _"the current arrangement is too fixed. gauranteed payments only work for people who have actually worked. that would mean a service is configured per user and per user level (partner, employee, etc) and payouts happens at a unit measurement (per hour but granular down to the minute/second) but also could be a percentage payout of the entire charge (personal mileage is 100% but company mileage would be 0% payout regardless who drove, leaving room for in the future an hourly rate to be paid out to the employee(s)). do you see where i am going with this?"_ — 23 Sep 2026
]
#v(4pt)

So `pay_rule` names a role or one person, what it pays for — their time or their vehicle — and how: per hour worked, a percentage of the line, a fixed amount, or nothing. `role` is the operator's own list; Partner, Employee and Contractor are where it starts.
#v(4pt)

*There is no on-site and remote.*
#v(4pt)

#callout(tone: "note")[
  _"whats the difference between on-site and remote? why are they categorical instead of universal?"_ — 23 Sep 2026 \
  _"mock logic looks good services are simply configurable services right? and items and services should be categorically seperated"_ — 23 Sep 2026
]
#v(4pt)

An agreement names the services it covers, each with its own allotment (`agreement_service`), so an on-site retainer is as easy as a remote one and an hour on a service it does not name is billed.
#v(4pt)

*A service charged per entry is how a flat rate is sold.*
#v(4pt)

#callout(tone: "note")[
  _"yes each can be a service charge, thats what allows flat rates as you pointed out per service item"_ — 23 Sep 2026
]
#v(4pt)

*Hours a retainer covers are paid as a percentage, and Bravo's is 0%.*
#v(4pt)

#callout(tone: "note")[
  _"retainer covered hours should be percentage based payouts (can be more than one responder each month and that too should be percentage) and bravo would effectively be 0% payout to responder"_ — 23 Sep 2026
]
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* Built in 0021 as I read it: the percentage is of what the retainer charged for the period, and it is split among whoever worked its covered hours by their share of them, counted in person-hours so a team hour is one each. Under a 20% rule on \$400, responders at 3 h and 1 h are paid \$60 and \$20; the retainer pays out 20% however many answered. It is a pay rule for `covered_time`, which can only be a percentage or nothing, so a person's own rule or a client's still wins the way every rule does. A covered hour bills nothing by the hour, and what it _earned_ is its share of the retainer.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* How the mock he approved works, as built in 0020:
#v(4pt)

#list([*A price counts heads.* `rate` is the first person, `additional_rate` each])
#v(4pt)

one after: \$80 and +\$50 is the \$130 for two. Nothing extra prices the job; the two equal prices the person.
#v(4pt)

#list([*The narrowest rule that has started pays.* One client's rule before every])
#v(4pt)

client's; then one person's before their role's; then the newest. Bravo's _"nothing gauranteed for responder"_ is a rule for Bravo that pays nothing, carried over from the null responder rate — without it the partners' \$25 would reach Bravo's calls.
#v(4pt)

#list([*Coverage is drawn in the order worked.* An unlimited allotment covers])
#v(4pt)

every billable hour on the services it names. A capped one covers the first hours of the period up to its pool; past that, the allotment's overage says whether they bill at the going rate or not at all.
#v(4pt)

#list([*Coverage is the agreement's own.* It starts from the service's])
#v(4pt)

subscription terms when a service is added to an agreement, and a later change to the service does not reach into an agreement already made.
#v(4pt)

#list([*Time bills to the nearest minute* (`bill_to_nearest_seconds` = 60 on every])
#v(4pt)

hourly service), which is _"bill per minute at the going rate"_ — 9 Sep. `minimum_charge` exists and is unset. Both were proposals in the mock, not requests. Pay is never rounded to them.
#v(4pt)

#list([*One place works out what an entry is worth.* `entry_worth` and])
#v(4pt)

`leg_worth`, from `billed_amount()` and `time_pay()`; every screen that showed a value read its own copy of the price lookup before.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]]* What is interim, and why:
#v(4pt)

#list([*A team is everybody who holds a role*, until entries name who worked. With])
#v(4pt)

two partners that is the two of them; with a third person it would count them too. _A team entry names nobody_ is the decision this will reopen.
#v(4pt)

#list([*Pay is counted to the minute*, because entries store minutes. The])
#v(4pt)

functions take seconds, so storing seconds changes no rule.
#v(4pt)

#list([*Vehicle rules are stored and shown but pay nobody yet.* A trip does not])
#v(4pt)

record which vehicle, so there is no owner to pay.
#v(4pt)

#list([*A capped pool is drawn within a charged period.* Periods are written when])
#v(4pt)

a retainer is charged, and the app does not charge them yet, so an hour in an uncharged period of a capped retainer has no value until it is — null, not a guess. What covered time pays waits on the charge the same way; a 0% rule pays 0 regardless, so Bravo's is always known.
#v(4pt)

#list([*Past a `deny` allotment, an hour is valued as billed.* The work should not])
#v(4pt)

have happened, and capture does not refuse it yet.
#v(4pt)

#list([*Pay is worked out live.* Until a payout is recorded when it is paid, a])
#v(4pt)

role change or a new rule moves what the reports say unpaid work pays.
#v(4pt)

#band[Not decided]
#v(4pt)

These have never been answered. They are questions, not gaps to be filled in by reasoning.
#v(4pt)

#list([*Emergency attendance is unpriced.*], [*What share of a retainer is paid for covered time, away from Bravo.* Bravo])
#v(4pt)

is the only retainer; another would pay nobody for covered time until a rule says what share.
#v(4pt)

#list([*What is open at cutover* — whether any credit, refund or unpaid invoice is])
#v(4pt)

still outstanding on the day FreshBooks is retired, and so whether an opening balance is needed at all. Known on the day.
#v(4pt)

#list([*Token lifetime* on the public invoice link.], [*The decimal library* for the application layer.], [*Three data gaps* — Valley Sky Farms has no address on file, Esmeralda has])
#v(4pt)

no district recorded, and Daniel's surname is inferred from his email address rather than confirmed.
#v(4pt)

#band[How this file is kept]
#v(4pt)

*A decision enters this file only with a quote.* If it cannot be quoted, it has not been decided.
#v(4pt)

*New information does not supersede an existing decision.* It sits alongside it until Tyler says which governs. On 9 September 2026 I read _"the default remote support is 2 hours"_ as cancelling _"unlimited for bravo"_, wrote that through the DDL, the tests, the diagrams and four commit messages as settled, and told him it was settled. It was not; the two are consistent, because the two-hour figure is the default a subscription carries and Bravo's agreement overrides it. The repository was deleted, correctly, because nothing in it could be told apart from that kind of reasoning.
#v(4pt)

*#text(fill: warn, weight: 700)[\[claude\]] entries are mine.* Analysis, arithmetic and consequences are useful and belong in the repository — but never in the same voice as a decision, and never in a commit message that reads as a record of one.
#v(4pt)

#v(12pt)
#stamp[Generated from `docs/decisions.md`. Change the register and regenerate.]
