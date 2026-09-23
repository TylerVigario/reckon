/**
 * Ask CDTFA what an address pays.
 *
 * Plain JavaScript on purpose: this is the one place that knows the contract
 * with CDTFA, and it has two callers with nothing else in common -- the app,
 * which prices a site the moment somebody saves one, and scripts/refresh-tax-
 * rates.mjs, which re-asks about everything on a schedule. A second copy of a
 * network contract is a copy that drifts, and the drift shows up as a rate.
 *
 * TWO QUESTIONS, because CDTFA answers them in two places:
 *
 *   the rate API      an address -> a total rate, their name for the area,
 *                     and the tax area code. Needs street, city AND zip; any
 *                     one missing is a 400 rather than a best guess.
 *   the rate layer    that code -> the state's share and the districts on top.
 *                     StateRate is one value statewide, so the statewide rate
 *                     is read rather than assumed.
 *
 * The two are checked against each other before either is believed. They are
 * the same department's figures for the same area; a disagreement means one
 * has moved, and that is not the moment to pick a side.
 */

const RATE_API = 'https://services.maps.cdtfa.ca.gov/api/taxrate/GetRateByAddress';
const RATE_LAYER =
	'https://services6.arcgis.com/snwvZ3EmaoXJiugR/arcgis/rest/services' +
	'/California_Sales_and_Use_Tax_Rates/FeatureServer/0/query';

/**
 * What the rate layer returns for one tax area code. Neither endpoint is
 * documented anywhere CDTFA publishes, so these two typedefs are the contract:
 * written down here means a field that stops arriving is a typecheck failure
 * rather than a NaN that reaches an invoice.
 *
 * Rates here are fractions -- 0.0725, not 7.25 -- which is why every one of
 * them is multiplied by 100 below.
 *
 * @typedef {{
 *   features?: {
 *     attributes?: { RATE: number; StateRate: number; CountyRate: number; CityRate: number };
 *   }[];
 * }} RateLayerAnswer
 */

/**
 * What the rate API returns for one address. `rate` is a fraction here too.
 * geocodeInfo is how a wrong answer is caught: see the refusal below.
 *
 * @typedef {{
 *   taxRateInfo?: { rate: number; jurisdiction: string; tac: string }[];
 *   geocodeInfo?: { confidence?: string; matchCodes?: string[]; formattedAddress?: string };
 * }} RateApiAnswer
 */

/**
 * A parsed body as `unknown`, so the casts below are narrowing something
 * rather than renaming an `any`.
 *
 * @param {Response} r
 * @returns {Promise<unknown>}
 */
const asJson = (r) => r.json();

/** Thrown when CDTFA cannot answer. The message is shown to whoever asked. */
export class NoAnswer extends Error {}

/** @type {Map<string, {state: string, district: string, total: string}>} */
const splits = new Map();

/**
 * The state/district split for one tax area code, asked once per area.
 * @param {string} tac
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<{state: string, district: string, total: string}>}
 */
export async function splitFor(tac, fetcher = fetch) {
	const known = splits.get(tac);
	if (known) return known;
	const q = new URLSearchParams({
		where: `TAC_txt='${tac}'`,
		outFields: 'RATE,StateRate,CountyRate,CityRate',
		returnGeometry: 'false',
		f: 'json'
	});
	const r = await fetcher(`${RATE_LAYER}?${q}`, { headers: { accept: 'application/json' } });
	if (!r.ok) throw new NoAnswer(`CDTFA's rate layer answered ${r.status}`);
	const layer = /** @type {RateLayerAnswer} */ (await asJson(r));
	const a = layer?.features?.[0]?.attributes;
	if (!a) throw new NoAnswer(`CDTFA's rate layer knows no area ${tac}`);
	// County and city both come back separately; both are district taxes, so
	// they are added. CDTFA-105 is a list of districts and names no other kind.
	const split = {
		state: (a.StateRate * 100).toFixed(4),
		district: ((a.CountyRate + a.CityRate) * 100).toFixed(4),
		total: (a.RATE * 100).toFixed(4)
	};
	splits.set(tac, split);
	return split;
}

/**
 * Price one address. Percentages come back as strings -- NUMERIC stays a
 * string the whole way, because a rate that round-trips through a float is a
 * rate that can be a cent out.
 *
 * @param {{street?: string|null, city?: string|null, postcode?: string|null}} where
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<{rate: string, state: string, district: string,
 *   jurisdiction: string, tac: string, confidence: string|null,
 *   matched: string|null}>}
 */
export async function priceAddress({ street, city, postcode }, fetcher = fetch) {
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
	/** @type {RateApiAnswer} */
	let body;
	try {
		const r = await fetcher(`${RATE_API}?${q}`, { headers: { accept: 'application/json' } });
		if (!r.ok) throw new NoAnswer(`CDTFA answered ${r.status} for that address.`);
		body = /** @type {RateApiAnswer} */ (await asJson(r));
	} catch (e) {
		if (e instanceof NoAnswer) throw e;
		throw new NoAnswer(`Could not reach CDTFA: ${e instanceof Error ? e.message : String(e)}`);
	}

	const answer = body?.taxRateInfo?.[0];
	if (!answer) throw new NoAnswer('CDTFA did not recognise that address.');

	// AN ANSWER IS NOT A MATCH. Asked about "zzzz, zzzz 00000" the API does not
	// decline -- it geocodes to US-101 S in San Jose, marks the match Ambiguous
	// at Low confidence, and returns San Jose's 10.000%. Taking that would open
	// a site in Kettleman billing a rate from three hundred miles away, which
	// is this system's original fault with a new coat on.
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

	const rate = (Number(answer.rate) * 100).toFixed(4);
	const split = await splitFor(answer.tac, fetcher);
	if (Number(split.total) !== Number(rate)) {
		throw new NoAnswer(
			`CDTFA's two sources disagree about ${answer.tac}: the rate API says ` +
				`${rate}% and the rate layer says ${split.total}%.`
		);
	}

	return {
		rate,
		state: split.state,
		district: split.district,
		jurisdiction: answer.jurisdiction,
		tac: answer.tac,
		confidence: body?.geocodeInfo?.confidence ?? null,
		matched: body?.geocodeInfo?.formattedAddress ?? null
	};
}
