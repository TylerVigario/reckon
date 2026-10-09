# Changelog

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

