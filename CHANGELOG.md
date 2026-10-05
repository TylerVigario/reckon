# Changelog

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

