/**
 * Ask CDTFA what an address pays.
 *
 * This is the one place that knows the contract with CDTFA. The app asks it
 * the moment somebody saves a site or asks again on its page, and the server
 * keeps every area and site in sync through it (#lib/server/tax-sync) -- as
 * does scripts/refresh-tax-rates.mjs, which runs that under plain Node. So
 * imports here are relative or #lib, never a $app module, which only exists
 * inside SvelteKit. A second copy of a network contract is a copy that
 * drifts, and the drift shows up as a rate.
 *
 * TWO QUESTIONS, because CDTFA answers them in two places:
 *
 *   the rate API      an address -> a total rate, their name for the area,
 *                     and the tax area code. Needs street, city AND zip; any
 *                     one missing is a 400 rather than a best guess.
 *   the rate layer    that code -> the state's share and the districts on top,
 *                     the day the rate took effect, and the quarter it is for:
 *                     the one in force and, once published, the coming one.
 *                     StateRate is one value statewide, so the statewide rate
 *                     is read rather than assumed.
 *
 * The two are checked against each other before either is believed. They are
 * the same department's figures for the same area; a disagreement means one
 * has moved, and that is not the moment to pick a side.
 */

import { Decimal, sum } from '../decimal.ts';

const RATE_API = 'https://services.maps.cdtfa.ca.gov/api/taxrate/GetRateByAddress';
const RATE_LAYER =
	'https://services6.arcgis.com/snwvZ3EmaoXJiugR/arcgis/rest/services' +
	'/California_Sales_and_Use_Tax_Rates/FeatureServer/0/query';

/**
 * What the rate layer returns for one tax area code. Neither endpoint is
 * documented anywhere CDTFA publishes, so these two types are the contract:
 * written down here means a field that stops arriving is a typecheck failure
 * rather than a NaN that reaches an invoice.
 *
 * Rates here are fractions -- 0.0725, not 7.25 -- which is why every one of
 * them is made a percentage below.
 */
type RateLayerAnswer = {
	features?: {
		attributes?: {
			RATE: number;
			StateRate: number;
			CountyRate: number;
			CityRate: number;
			/** The day this rate took effect, as epoch milliseconds. */
			START_DATE: number;
			/** The quarter this record describes, as epoch milliseconds: its first day. */
			DateStamp: number;
		};
	}[];
};

/**
 * What the rate API returns for one address. `rate` is a fraction here too.
 * geocodeInfo is how a wrong answer is caught: see the refusal below.
 */
type RateApiAnswer = {
	taxRateInfo?: { rate: number; jurisdiction: string; tac: string }[];
	geocodeInfo?: { confidence?: string; matchCodes?: string[]; formattedAddress?: string };
};

/**
 * A parsed body as `unknown`, so the casts below are narrowing something
 * rather than renaming an `any`.
 */
const asJson = (r: Response): Promise<unknown> => r.json();

/** Thrown when CDTFA cannot answer. The message is shown to whoever asked. */
export class NoAnswer extends Error {}

/**
 * How long either question may take. CDTFA answers in well under a second --
 * measured in October 2026, the rate API in about 0.5 s and the rate layer in
 * 0.1 to 0.3 s -- so ten seconds is a bad day, not a normal one. A site cannot
 * be saved without a rate, so this is generous rather than tight; but it is a
 * limit, where none at all held the person saving a site for as long as the
 * runtime allowed.
 */
const TIMEOUT_MS = 10_000;

/**
 * Asks one question, and gives back the parsed answer or a NoAnswer saying why
 * not. Nothing else gets out: running out of time, no connection, an error
 * status and a body that is not JSON are all CDTFA not answering, and the
 * person saving a site is told so rather than shown a 500.
 */
async function ask(
	url: string,
	fetcher: typeof fetch,
	refused: (status: number) => string
): Promise<unknown> {
	try {
		const r = await fetcher(url, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!r.ok) throw new NoAnswer(refused(r.status));
		return await asJson(r);
	} catch (e) {
		if (e instanceof NoAnswer) throw e;
		if (e instanceof Error && e.name === 'TimeoutError')
			throw new NoAnswer(`CDTFA did not answer within ${TIMEOUT_MS / 1000} seconds.`);
		throw new NoAnswer(`Could not reach CDTFA: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/**
 * Fractions CDTFA sends as JSON numbers -- 0.0775 -- added up and made a
 * percentage to four places: "7.7500". A JSON number's shortest spelling is the
 * one CDTFA wrote, so each is read from that text and never multiplied as a
 * float; anything that does not spell a plain decimal is not a rate.
 */
function percent(...fractions: unknown[]): string {
	const texts = fractions.map((f) => (typeof f === 'number' ? String(f) : ''));
	const bad = texts.findIndex((t) => !/^\d+(\.\d+)?$/.test(t));
	if (bad !== -1)
		throw new NoAnswer(`CDTFA sent a rate that is not one: ${String(fractions[bad])}.`);
	return sum(texts).mul(100).toFixed(4);
}

/**
 * One rate CDTFA publishes for a tax area: the state's share and the districts',
 * the total, the day it took effect, and the quarter the record describes. The
 * layer is published ahead of a quarter (its records for 1 October 2026 were
 * made on 12 August), and while it is, an area has a record for the quarter in
 * force and one for the quarter coming.
 */
export type PublishedRate = {
	start: string;
	quarter: string;
	state: string;
	district: string;
	total: string;
};

/**
 * A day CDTFA sends as epoch milliseconds, as YYYY-MM-DD. It sends the day's
 * first moment in California, seven or eight hours into the same day in UTC,
 * so the UTC date is the day.
 */
const dayOf = (ms: unknown): string => {
	if (typeof ms !== 'number' || !Number.isFinite(ms))
		throw new NoAnswer(`CDTFA sent a date that is not one: ${String(ms)}.`);
	return new Date(ms).toISOString().slice(0, 10);
};

/**
 * Every rate CDTFA publishes for one tax area code, by the quarter each
 * describes: the one in force, and the coming quarter's where it is out.
 */
export async function ratesFor(
	tac: string,
	fetcher: typeof fetch = fetch
): Promise<PublishedRate[]> {
	// Written into the layer's query, so it is a code or nothing is asked.
	if (!/^[0-9A-Z]{1,16}$/.test(tac)) throw new NoAnswer(`${tac} is not a tax area code.`);
	const q = new URLSearchParams({
		where: `TAC_txt='${tac}'`,
		outFields: 'RATE,StateRate,CountyRate,CityRate,START_DATE,DateStamp',
		orderByFields: 'DateStamp',
		returnGeometry: 'false',
		f: 'json'
	});
	const layer = (await ask(
		`${RATE_LAYER}?${q}`,
		fetcher,
		(status) => `CDTFA's rate layer answered ${status}`
	)) as RateLayerAnswer;
	const rates = (layer?.features ?? [])
		.map((f) => f.attributes)
		.filter((a) => a !== undefined)
		// County and city both come back separately; both are district taxes,
		// so they are added. CDTFA-105 is a list of districts and names no
		// other kind.
		.map((a) => ({
			start: dayOf(a.START_DATE),
			quarter: dayOf(a.DateStamp),
			state: percent(a.StateRate),
			district: percent(a.CountyRate, a.CityRate),
			total: percent(a.RATE)
		}))
		.sort((x, y) => x.quarter.localeCompare(y.quarter));
	if (!rates.length) throw new NoAnswer(`CDTFA's rate layer knows no area ${tac}`);
	return rates;
}

/** Which of an area's published rates is in force on `day`: its quarter's. */
export const inForce = (rates: readonly PublishedRate[], day: string) =>
	rates.findLast((r) => r.quarter <= day) ?? rates[0];

export type Priced = {
	rate: string;
	jurisdiction: string;
	tac: string;
	/** Every rate CDTFA publishes for its area, the coming quarter's among them. */
	rates: PublishedRate[];
	confidence: string | null;
	matched: string | null;
};

/**
 * Price one address. Percentages come back as strings -- NUMERIC stays a
 * string the whole way, because a rate that round-trips through a float is a
 * rate that can be a cent out.
 *
 * The rate API answers today's rate; the rate layer answers every rate it
 * publishes for the area, and the one in force on `today`, the business's day,
 * has to agree with it.
 */
export async function priceAddress(
	{
		street,
		city,
		postcode
	}: { street?: string | null; city?: string | null; postcode?: string | null },
	today: string,
	fetcher: typeof fetch = fetch
): Promise<Priced> {
	const missing = [
		street ? null : 'a street',
		city ? null : 'a city',
		postcode ? null : 'a postcode'
	].filter(Boolean);
	if (missing.length) {
		throw new NoAnswer(
			`CDTFA needs a street, a city and a postcode together, and this is missing ${missing.join(
				' and '
			)}.`
		);
	}

	const q = new URLSearchParams({
		address: String(street),
		city: String(city),
		zip: String(postcode)
	});
	const body = (await ask(
		`${RATE_API}?${q}`,
		fetcher,
		(status) => `CDTFA answered ${status} for that address.`
	)) as RateApiAnswer;

	const answer = body?.taxRateInfo?.[0];
	if (!answer) throw new NoAnswer('CDTFA did not recognise that address.');

	// AN ANSWER IS NOT A MATCH. Asked about "zzzz, zzzz 00000" the API does not
	// decline -- it geocodes to US-101 S in San Jose, marks the match Ambiguous
	// at Low confidence, and returns San Jose's 10.000%. Taking that would open
	// a site in Yuba City billing San Jose's rate -- a rate charged at an address
	// it was never true for.
	//
	// So the geocode is read as carefully as the rate. Anything short of a
	// confident, unambiguous match is refused, and the refusal says where CDTFA
	// thought the address was -- because seeing "San Jose" is what tells
	// somebody they typed the postcode wrong.
	const geo = body?.geocodeInfo ?? {};
	const codes = geo.matchCodes ?? [];
	const vague =
		geo.confidence !== 'High' ||
		codes.includes('Ambiguous') ||
		codes.includes('UpHierarchy') ||
		!codes.includes('Good');
	if (vague) {
		throw new NoAnswer(
			`CDTFA could not place that address confidently -- it matched it to ` +
				`${geo.formattedAddress ?? 'somewhere else'} (${codes.join(', ') || 'no match code'}, ` +
				`${geo.confidence ?? 'no'} confidence). Check the street and postcode.`
		);
	}
	// More than one comes back near a boundary, and picking one silently is how
	// the wrong side of a street gets billed.
	if ((body.taxRateInfo?.length ?? 0) > 1) {
		throw new NoAnswer(
			'That address sits on an area boundary and CDTFA gave more than one rate. ' +
				'It needs checking by hand before anything is billed at it.'
		);
	}

	const rate = percent(answer.rate);
	const rates = await ratesFor(answer.tac, fetcher);
	const now = inForce(rates, today);
	if (!Decimal.from(now.total).eq(rate)) {
		throw new NoAnswer(
			`CDTFA's two sources disagree about ${answer.tac}: the rate API says ` +
				`${rate}% and the rate layer says ${now.total}%.`
		);
	}

	return {
		rate,
		rates,
		jurisdiction: answer.jurisdiction,
		tac: answer.tac,
		confidence: body?.geocodeInfo?.confidence ?? null,
		matched: body?.geocodeInfo?.formattedAddress ?? null
	};
}
