# Changelog

## [0.9.1](https://github.com/TylerVigario/reckon/compare/v0.9.0...v0.9.1) (2026-11-16)

### Build & Packaging

* Every dependency that can move is current, and Better Auth loads without Kysely ([#180](https://github.com/TylerVigario/reckon/pull/180))

## [0.9.0](https://github.com/TylerVigario/reckon/compare/v0.8.0...v0.9.0) (2026-11-16)

### Features

* Time, Trips and Today are drawn to Primer, their forms' choices picked from groups ([#175](https://github.com/TylerVigario/reckon/pull/175))
* Sign-in, emailed links and a client's invoice are drawn to Primer, and an error has a page ([#176](https://github.com/TylerVigario/reckon/pull/176))
* The shell is drawn to Primer, its sections down the side from 768px and a working button Primer's loading button ([#177](https://github.com/TylerVigario/reckon/pull/177))

### Refactoring

* Primer's classes are unscoped, no screen gated by a primer class ([#178](https://github.com/TylerVigario/reckon/pull/178))
* Navigation calls SvelteKit's replacements for replaceState and invalidateAll ([#179](https://github.com/TylerVigario/reckon/pull/179))

## [0.8.0](https://github.com/TylerVigario/reckon/compare/v0.7.0...v0.8.0) (2026-11-15)

### Features

* Reckon sends email, and tells a person whenever their password changes ([#125](https://github.com/TylerVigario/reckon/pull/125))
* A person is invited by an emailed link, and an address is proven by using one ([#126](https://github.com/TylerVigario/reckon/pull/126))
* A changed email waits until the new address is proven, and the old one is told ([#127](https://github.com/TylerVigario/reckon/pull/127))
* Reckon's emails are HTML, laid out by hand, with the plain text beside ([#129](https://github.com/TylerVigario/reckon/pull/129))
* Whoever forgot their password is emailed a link to choose a new one ([#130](https://github.com/TylerVigario/reckon/pull/130))
* Everyone signs in with a passkey, and there are no passwords ([#140](https://github.com/TylerVigario/reckon/pull/140))
* Someone stays signed in until two weeks unused, as GitHub keeps them ([#141](https://github.com/TylerVigario/reckon/pull/141))
* Catalogue, Entities, Reports, a client and someone's pay are tabs ([#147](https://github.com/TylerVigario/reckon/pull/147))
* [**breaking**] The database's owner migrates it, and the server owns nothing ([#148](https://github.com/TylerVigario/reckon/pull/148))
* The server's log is one JSON record a line, and an error nobody meant is shown only by its id ([#149](https://github.com/TylerVigario/reckon/pull/149))
* A security log of every sign-in, refusal and access change, which each person sees ([#151](https://github.com/TylerVigario/reckon/pull/151))
* History covers people and every row added, and nothing but its triggers writes it ([#152](https://github.com/TylerVigario/reckon/pull/152))
* Team shows when each person last signed in, their passkeys and their open sessions ([#153](https://github.com/TylerVigario/reckon/pull/153))
* Someone is emailed when Team changes their name, access or whether they are active ([#154](https://github.com/TylerVigario/reckon/pull/154))
* Unsent work on a phone is its maker's, and signing out says what is waiting ([#155](https://github.com/TylerVigario/reckon/pull/155))
* A time entry is changed or removed after the fact, until it is billed or paid ([#156](https://github.com/TylerVigario/reckon/pull/156))
* A time entry is changed or removed with no signal, and merged with a change made meanwhile ([#157](https://github.com/TylerVigario/reckon/pull/157))
* What a phone keeps for no signal is cut to what is done there, and goes with the session ([#158](https://github.com/TylerVigario/reckon/pull/158))
* Catalogue is drawn to Primer, its materials, services and agreements alike ([#159](https://github.com/TylerVigario/reckon/pull/159))
* Stock is received as its receipt or invoice says it, every item on it, the tax split by cost ([#160](https://github.com/TylerVigario/reckon/pull/160))
* One item's stock is put right by hand, taken off or put on, with why ([#161](https://github.com/TylerVigario/reckon/pull/161))
* A material is changed on its Details tab, priced from today, and retired ([#162](https://github.com/TylerVigario/reckon/pull/162))
* Stock is counted on a day and the count applied, each difference put right ([#163](https://github.com/TylerVigario/reckon/pull/163))
* Stock is received, adjusted and counted with no signal, and sent when there is one ([#164](https://github.com/TylerVigario/reckon/pull/164))
* A material is changed and a service added with no signal, and merged when it arrives ([#165](https://github.com/TylerVigario/reckon/pull/165))
* Who is on a team entry and what a service is keep their history ([#166](https://github.com/TylerVigario/reckon/pull/166))
* Reckon is drawn in Primer's own primitives, Octicons and Noto ([#167](https://github.com/TylerVigario/reckon/pull/167))
* Entities are drawn to Primer, a client and a site each a record with tabs ([#169](https://github.com/TylerVigario/reckon/pull/169))
* Settings are drawn to Primer, each setting saved with its own Save ([#170](https://github.com/TylerVigario/reckon/pull/170))
* Reports are drawn to Primer, each seen one way at a time ([#172](https://github.com/TylerVigario/reckon/pull/172))
* Invoices are drawn to Primer, a line added from a list that folds ([#173](https://github.com/TylerVigario/reckon/pull/173))

### Bug Fixes

* The sign-in limit holds against tries sent at once and IPv6 addresses ([#123](https://github.com/TylerVigario/reckon/pull/123))
* Every try at a password is recorded, and limited per email as well as per address ([#124](https://github.com/TylerVigario/reckon/pull/124))
* A release carries the email layout that scripts/user.mjs imports ([#131](https://github.com/TylerVigario/reckon/pull/131))
* Help names the business's contact details, not someone with Full access ([#133](https://github.com/TylerVigario/reckon/pull/133))
* A password meets NIST's rules when it is chosen, and one seen in a breach stops at sign-in ([#134](https://github.com/TylerVigario/reckon/pull/134))
* Field cannot open an invoice that has gone out through its add-a-line page ([#135](https://github.com/TylerVigario/reckon/pull/135))
* The uuid a phone makes is unique to its maker, so another's finds nothing of theirs ([#136](https://github.com/TylerVigario/reckon/pull/136))
* A line's kind and who paid it are picked from radio groups ([#174](https://github.com/TylerVigario/reckon/pull/174))

### Refactoring

* Better Auth's routes are mounted as its SvelteKit guide documents, none served yet ([#138](https://github.com/TylerVigario/reckon/pull/138))

### Build & Packaging

* Reckon signs in with Better Auth 1.7.18 ([#128](https://github.com/TylerVigario/reckon/pull/128))
* Every package is bundled, and a release carries no node_modules ([#142](https://github.com/TylerVigario/reckon/pull/142))

## [0.7.0](https://github.com/TylerVigario/reckon/compare/v0.6.0...v0.7.0) (2026-11-08)

### Features

* A site's round trip and drive time are Google's route from the business ([#87](https://github.com/TylerVigario/reckon/pull/87))
* Each device can be set to light or dark, in the profile ([#105](https://github.com/TylerVigario/reckon/pull/105))
* What reaches past itself, or cannot be undone, asks first ([#106](https://github.com/TylerVigario/reckon/pull/106))
* Each person has Full or Field access, and every route says which it needs ([#112](https://github.com/TylerVigario/reckon/pull/112))
* People are a team, each with a page of their own ([#113](https://github.com/TylerVigario/reckon/pull/113))
* A person is added, and a password reset, from Team ([#115](https://github.com/TylerVigario/reckon/pull/115))
* A person changes their own password, on Your profile ([#116](https://github.com/TylerVigario/reckon/pull/116))
* A contact has a page of their own, and a client picks who gets its invoices ([#118](https://github.com/TylerVigario/reckon/pull/118))
* A site asks CDTFA again, and is the one place its rate is shown ([#120](https://github.com/TylerVigario/reckon/pull/120))
* A secret can be given as a file, and the database's password is libpq's file ([#122](https://github.com/TylerVigario/reckon/pull/122))

### Bug Fixes

* A time format left to the locale shows the time it gives ([#104](https://github.com/TylerVigario/reckon/pull/104))
* A screen's header pins one row, and its title scrolls away beneath it ([#107](https://github.com/TylerVigario/reckon/pull/107))
* A locale is listed by its name in the screens' language, and fits a phone ([#109](https://github.com/TylerVigario/reckon/pull/109))
* A line keeps where it was taxed, so Schedule A reads a period as it was billed ([#111](https://github.com/TylerVigario/reckon/pull/111))
* A client following the house default shows no terms of its own ([#117](https://github.com/TylerVigario/reckon/pull/117))
* Every command reads .env, and nothing assumes a database or a secret ([#121](https://github.com/TylerVigario/reckon/pull/121))

### Refactoring

* The schema reference reads its tables and notes as data ([#110](https://github.com/TylerVigario/reckon/pull/110))

### Build & Packaging

* [**breaking**] The repository is the SvelteKit project, and a release is its runtime ([#82](https://github.com/TylerVigario/reckon/pull/82))
* Every dependency that can move is up to date ([#89](https://github.com/TylerVigario/reckon/pull/89))
* Press 0.4.0 in place of the submodule, and npm run print in place of just ([#91](https://github.com/TylerVigario/reckon/pull/91))
* Press 0.7.0, and the print scripts call press's own tools ([#96](https://github.com/TylerVigario/reckon/pull/96))
* Every dependency that can move is current, and CodeQL's two steps update as one ([#100](https://github.com/TylerVigario/reckon/pull/100))
* Press 0.8.0 ([#101](https://github.com/TylerVigario/reckon/pull/101))
* Esbuild's install script is denied, and no dependency runs one ([#103](https://github.com/TylerVigario/reckon/pull/103))
* Press 0.10.0 ([#114](https://github.com/TylerVigario/reckon/pull/114))

## [0.6.0](https://github.com/TylerVigario/reckon/compare/v0.5.0...v0.6.0) (2026-10-09)

### Features

* Stock is received in the app, with its costs, who paid and its receipt ([#61](https://github.com/TylerVigario/reckon/pull/61))
* A draft takes lines for what was bought or paid for, with who paid and the receipt ([#64](https://github.com/TylerVigario/reckon/pull/64))
* A draft takes lines drawn from stock, costed at the average or the oldest first ([#65](https://github.com/TylerVigario/reckon/pull/65))
* Lines wait on the phone, and a draft opens with no signal ([#66](https://github.com/TylerVigario/reckon/pull/66))
* A draft can be started with no signal, and a line meant for one that went out starts another ([#67](https://github.com/TylerVigario/reckon/pull/67))
* A line added by hand can be changed or taken off its draft, and keeps its whole history ([#68](https://github.com/TylerVigario/reckon/pull/68))
* A line changed on a phone with no signal is merged field by field with any change made meanwhile ([#69](https://github.com/TylerVigario/reckon/pull/69))
* A team entry names who was on it, and bills and pays at that crew ([#70](https://github.com/TylerVigario/reckon/pull/70))
* A trip names its vehicle, and its miles pay the vehicle's owner ([#72](https://github.com/TylerVigario/reckon/pull/72))
* A trip is recorded in the app, each leg given to whoever caused it ([#73](https://github.com/TylerVigario/reckon/pull/73))
* A trip's drives take their miles from Google's route ([#74](https://github.com/TylerVigario/reckon/pull/74))
* A trip is changed after it is saved ([#75](https://github.com/TylerVigario/reckon/pull/75))
* A trip is recorded or changed with no signal, and sent when there is one ([#77](https://github.com/TylerVigario/reckon/pull/77))
* Pay is recorded when it is paid, and stands ([#78](https://github.com/TylerVigario/reckon/pull/78))
* Pay is separated by what each role is paid as ([#79](https://github.com/TylerVigario/reckon/pull/79))
* An invoice is sent with its link ([#80](https://github.com/TylerVigario/reckon/pull/80))
* An address is one field, chosen from Google, and stored in its pieces ([#81](https://github.com/TylerVigario/reckon/pull/81))

### Bug Fixes

* The behaviour job waits a minute for its browser, and says when it never came ([#63](https://github.com/TylerVigario/reckon/pull/63))
* A team is whoever is ticked, in the start page's prompt and the schema ([#71](https://github.com/TylerVigario/reckon/pull/71))

## [0.5.0](https://github.com/TylerVigario/reckon/compare/v0.4.0...v0.5.0) (2026-10-05)

### Features

* Units are the operator's own list, and a material is counted in one ([#58](https://github.com/TylerVigario/reckon/pull/58))
* The Settings menu says what each screen is set to, under its name ([#60](https://github.com/TylerVigario/reckon/pull/60))

### Bug Fixes

* The address field reaches Google, and waits until its API is ready ([#59](https://github.com/TylerVigario/reckon/pull/59))

## [0.4.0](https://github.com/TylerVigario/reckon/compare/v0.3.1...v0.4.0) (2026-10-05)

### Features

* Install reckon as an app, and open Today and Time without a signal ([#20](https://github.com/TylerVigario/reckon/pull/20))
* Dates are worked with through Temporal, the polyfill only where it is missing ([#47](https://github.com/TylerVigario/reckon/pull/47))
* Every figure and date is written by one vocabulary, from its exact value ([#48](https://github.com/TylerVigario/reckon/pull/48))
* Each person reads dates and figures in their own locale, set in their profile ([#49](https://github.com/TylerVigario/reckon/pull/49))
* Each tax rule rounds its tax its own way, and every invoice total comes from one place ([#51](https://github.com/TylerVigario/reckon/pull/51))
* Every amount is worked out to its currency's own places ([#52](https://github.com/TylerVigario/reckon/pull/52))
* A service's rate is a price, to four places, finer than the currency ([#54](https://github.com/TylerVigario/reckon/pull/54))
* An entry keeps its start and end, and is counted to the second ([#55](https://github.com/TylerVigario/reckon/pull/55))
* Past work is a start, a length and an end, and any two give the third ([#56](https://github.com/TylerVigario/reckon/pull/56))
* A running timer's start can be moved back to when the work began ([#57](https://github.com/TylerVigario/reckon/pull/57))

### Bug Fixes

* Keep a queued entry the server refuses, and say why ([#23](https://github.com/TylerVigario/reckon/pull/23))
* A sent invoice stays sent and keeps its lines ([#33](https://github.com/TylerVigario/reckon/pull/33))
* Serve anything that is not a page under a policy that runs nothing ([#34](https://github.com/TylerVigario/reckon/pull/34))
* The business's time zone decides what day it is ([#35](https://github.com/TylerVigario/reckon/pull/35))
* The sign-in page's stylesheet is open to the sign-in page ([#36](https://github.com/TylerVigario/reckon/pull/36))
* The history describes a file rather than copying it in ([#37](https://github.com/TylerVigario/reckon/pull/37))
* A sign-in link whose next names another site goes home ([#38](https://github.com/TylerVigario/reckon/pull/38))
* The server works in UTC, and every day is the person's or the business's ([#39](https://github.com/TylerVigario/reckon/pull/39))
* The tax-rate refresh starts again ([#41](https://github.com/TylerVigario/reckon/pull/41))
* A tax area's split is asked again, not kept until the server restarts ([#42](https://github.com/TylerVigario/reckon/pull/42))
* CDTFA and Google are given a time limit, and Google's reasons stay in the log ([#43](https://github.com/TylerVigario/reckon/pull/43))
* A release is bumped by a step, never given a version ([#45](https://github.com/TylerVigario/reckon/pull/45))
* A service worker update that cannot be answered is not an error ([#46](https://github.com/TylerVigario/reckon/pull/46))

## [0.3.1](https://github.com/TylerVigario/reckon/compare/v0.3.0...v0.3.1) (2026-10-02)

### Bug Fixes

* Name the proxy's address header, and check DATABASE_URL at start ([#17](https://github.com/TylerVigario/reckon/pull/17))
* Nothing inline that the content security policy refuses ([#18](https://github.com/TylerVigario/reckon/pull/18))

## [0.3.0](https://github.com/TylerVigario/reckon/compare/v0.2.0...v0.3.0) (2026-10-02)

### Features

* Tab icons that say what each tab holds, on a bar that no longer covers the page ([#16](https://github.com/TylerVigario/reckon/pull/16))

### Build & Packaging

* [**breaking**] SvelteKit 3 and every dependency current ([#12](https://github.com/TylerVigario/reckon/pull/12))

## [0.2.0](https://github.com/TylerVigario/reckon/releases/tag/v0.2.0) (2026-10-01)

### Features

* Reckon, invoicing and time tracking for a small trade business

