import { describe, expect, it } from 'vitest';
import { NoAnswer, priceAddress } from './cdtfa.ts';

/**
 * The contract with CDTFA, tested against a fetcher that answers the way CDTFA
 * does -- including the ways it answers badly.
 *
 * This is the one module whose wrong answer becomes a wrong invoice, so every
 * refusal it makes has a case below.
 */

const HERE = { street: '8556 Gibson Ranch Park Rd', city: 'Elverta', postcode: '95626' };

/** A geocode CDTFA is sure about. */
const CONFIDENT = {
	confidence: 'High',
	matchCodes: ['Good'],
	formattedAddress: '8556 Gibson Ranch Park Rd, Elverta, CA 95626'
};

/** Answers the rate API and the rate layer from one pair of canned replies. */
const fakeCdtfa = (rateApi: unknown, rateLayer: unknown, ok = true): typeof fetch =>
	((url: string) =>
		Promise.resolve({
			ok,
			status: ok ? 200 : 503,
			// The rate layer is ArcGIS; everything else is the rate API. Which
			// one was asked is the only thing the fake needs the URL for.
			json: () => Promise.resolve(url.includes('arcgis') ? rateLayer : rateApi)
		})) as unknown as typeof fetch;

const layer = (state: number, county: number, city: number) => ({
	features: [
		{
			attributes: {
				RATE: state + county + city,
				StateRate: state,
				CountyRate: county,
				CityRate: city
			}
		}
	]
});

describe('priceAddress', () => {
	it('splits a rate into the state share and the districts', async () => {
		const answer = await priceAddress(
			HERE,
			fakeCdtfa(
				{
					taxRateInfo: [{ rate: 0.0775, jurisdiction: 'SACRAMENTO COUNTY', tac: 'T01' }],
					geocodeInfo: CONFIDENT
				},
				layer(0.06, 0.0175, 0)
			)
		);
		expect(answer).toMatchObject({
			rate: '7.7500',
			state: '6.0000',
			district: '1.7500',
			jurisdiction: 'SACRAMENTO COUNTY',
			tac: 'T01'
		});
	});

	// Percentages stay strings the whole way: a rate that round-trips through a
	// float is a rate that can be a cent out.
	it('answers in strings, never numbers', async () => {
		const answer = await priceAddress(
			HERE,
			fakeCdtfa(
				{
					taxRateInfo: [{ rate: 0.0725, jurisdiction: 'TUOLUMNE COUNTY', tac: 'T02' }],
					geocodeInfo: CONFIDENT
				},
				layer(0.06, 0.0125, 0)
			)
		);
		for (const part of [answer.rate, answer.state, answer.district])
			expect(typeof part).toBe('string');
	});

	// County and city are both district taxes, so they add. CDTFA-105 lists
	// districts and names no other kind.
	it('adds the county and the city into one district figure', async () => {
		const answer = await priceAddress(
			HERE,
			fakeCdtfa(
				{
					taxRateInfo: [{ rate: 0.0875, jurisdiction: 'SONORA', tac: 'T03' }],
					geocodeInfo: CONFIDENT
				},
				layer(0.06, 0.0175, 0.01)
			)
		);
		expect(answer.district).toBe('2.7500');
	});

	// THE ONE THAT MATTERS. Asked about "zzzz, zzzz 00000" the API does not
	// decline -- it geocodes to US-101 S in San Jose, marks the match Ambiguous
	// at Low confidence, and returns San Jose's 10%. Taking that opens a site
	// in Yuba City billing San Jose's rate.
	it('refuses an answer CDTFA was not confident about', async () => {
		await expect(
			priceAddress(
				{ street: 'zzzz', city: 'zzzz', postcode: '00000' },
				fakeCdtfa(
					{
						taxRateInfo: [{ rate: 0.1, jurisdiction: 'SAN JOSE', tac: 'T04' }],
						geocodeInfo: {
							confidence: 'Low',
							matchCodes: ['Ambiguous'],
							formattedAddress: 'US-101 S, San Jose'
						}
					},
					layer(0.06, 0.0325, 0.0075)
				)
			)
		).rejects.toThrow(NoAnswer);
	});

	// And the refusal says where it thought the address was, because seeing
	// "San Jose" is what tells somebody they typed the postcode wrong.
	it('names the place it matched when it refuses', async () => {
		await expect(
			priceAddress(
				HERE,
				fakeCdtfa(
					{
						taxRateInfo: [{ rate: 0.1, jurisdiction: 'SAN JOSE', tac: 'T05' }],
						geocodeInfo: {
							confidence: 'Low',
							matchCodes: ['Ambiguous'],
							formattedAddress: 'US-101 S, San Jose'
						}
					},
					layer(0.06, 0.04, 0)
				)
			)
		).rejects.toThrow(/San Jose/);
	});

	/**
	 * The four clauses of the refusal, one test each.
	 *
	 * Each geocode fails exactly one clause. A test whose geocode also fails a
	 * second clause passes for a reason other than the one it names, and keeps
	 * passing when that reason goes away.
	 */
	it.each([
		['low confidence, and nothing else wrong', { confidence: 'Low', matchCodes: ['Good'] }],
		[
			'an ambiguous match at high confidence',
			{ confidence: 'High', matchCodes: ['Good', 'Ambiguous'] }
		],
		[
			'a match that climbed to a wider area',
			{ confidence: 'High', matchCodes: ['Good', 'UpHierarchy'] }
		],
		['no Good among the match codes at all', { confidence: 'High', matchCodes: ['Approximate'] }],
		['no geocode information at all', {}]
	])('refuses on %s', async (_why, geocodeInfo) => {
		await expect(
			priceAddress(
				HERE,
				fakeCdtfa(
					{
						taxRateInfo: [
							{ rate: 0.0775, jurisdiction: 'SACRAMENTO COUNTY', tac: `T1${_why.length}` }
						],
						geocodeInfo
					},
					layer(0.06, 0.0175, 0)
				)
			)
		).rejects.toThrow(NoAnswer);
	});

	it('refuses a geocode that climbed to a wider area', async () => {
		await expect(
			priceAddress(
				HERE,
				fakeCdtfa(
					{
						taxRateInfo: [{ rate: 0.0775, jurisdiction: 'SACRAMENTO COUNTY', tac: 'T06' }],
						geocodeInfo: {
							confidence: 'High',
							matchCodes: ['Good', 'UpHierarchy'],
							formattedAddress: 'Sacramento County'
						}
					},
					layer(0.06, 0.0175, 0)
				)
			)
		).rejects.toThrow(NoAnswer);
	});

	// Two rates come back near a boundary, and picking one silently is how the
	// wrong side of a street gets billed.
	it('refuses to choose when the address sits on a boundary', async () => {
		await expect(
			priceAddress(
				HERE,
				fakeCdtfa(
					{
						taxRateInfo: [
							{ rate: 0.0775, jurisdiction: 'SACRAMENTO COUNTY', tac: 'T07' },
							{ rate: 0.0875, jurisdiction: 'SONORA', tac: 'T08' }
						],
						geocodeInfo: CONFIDENT
					},
					layer(0.06, 0.0175, 0)
				)
			)
		).rejects.toThrow(/boundary/);
	});

	// The two sources are the same department's figures for the same area. A
	// disagreement means one has moved, and that is not the moment to pick.
	it('refuses when the rate API and the rate layer disagree', async () => {
		await expect(
			priceAddress(
				HERE,
				fakeCdtfa(
					{
						taxRateInfo: [{ rate: 0.0775, jurisdiction: 'SACRAMENTO COUNTY', tac: 'T09' }],
						geocodeInfo: CONFIDENT
					},
					layer(0.06, 0.0225, 0) // 8.25 against the API's 7.75
				)
			)
		).rejects.toThrow(/disagree/);
	});

	// The rate API needs all three together; any one missing is a 400 rather
	// than a best guess, so this refuses before asking.
	it('refuses an incomplete address without calling out', async () => {
		let called = false;
		const never = (() => {
			called = true;
			return Promise.reject(new Error('should not have been asked'));
		}) as unknown as typeof fetch;

		await expect(
			priceAddress({ street: '8556 Gibson Ranch Park Rd', city: 'Elverta' }, never)
		).rejects.toThrow(/postcode/);
		expect(called).toBe(false);
	});

	it('says so when CDTFA does not recognise the address at all', async () => {
		await expect(
			priceAddress(HERE, fakeCdtfa({ taxRateInfo: [], geocodeInfo: CONFIDENT }, layer(0.06, 0, 0)))
		).rejects.toThrow(/did not recognise/);
	});

	it('reports an HTTP failure as a refusal rather than a rate', async () => {
		await expect(priceAddress(HERE, fakeCdtfa({}, {}, false))).rejects.toThrow(NoAnswer);
	});
});

/**
 * California's rates change on the first day of a quarter, and a server runs
 * straight through it. Whatever it learnt about an area before then is not
 * evidence of what the area pays after.
 */
describe('a tax area asked about again', () => {
	const sacramento = (rate: number) => ({
		taxRateInfo: [{ rate, jurisdiction: 'SACRAMENTO COUNTY', tac: 'T20' }],
		geocodeInfo: CONFIDENT
	});

	it("is asked again, so a new quarter's rate is taken without a restart", async () => {
		await priceAddress(HERE, fakeCdtfa(sacramento(0.0775), layer(0.06, 0.0175, 0)));
		const after = await priceAddress(HERE, fakeCdtfa(sacramento(0.08), layer(0.06, 0.02, 0)));
		expect(after).toMatchObject({ rate: '8.0000', district: '2.0000' });
	});

	it('is asked again, so a split that moved under the same total is taken', async () => {
		await priceAddress(HERE, fakeCdtfa(sacramento(0.0775), layer(0.06, 0.0175, 0)));
		const after = await priceAddress(HERE, fakeCdtfa(sacramento(0.0775), layer(0.0625, 0.015, 0)));
		expect(after).toMatchObject({ state: '6.2500', district: '1.5000' });
	});

	it('is asked once within a run that shares what it learns', async () => {
		let asked = 0;
		const fake = fakeCdtfa(sacramento(0.0775), layer(0.06, 0.0175, 0));
		const counting = ((url: string) => {
			if (url.includes('arcgis')) asked++;
			return fake(url);
		}) as typeof fetch;
		const run = new Map();
		await priceAddress(HERE, counting, run);
		await priceAddress(HERE, counting, run);
		expect(asked).toBe(1);
	});
});

/**
 * CDTFA not answering is CDTFA not answering, however it happens: the person
 * saving a site is told so, rather than held, or shown a 500.
 */
describe('when CDTFA does not answer', () => {
	const asked = {
		taxRateInfo: [{ rate: 0.0775, jurisdiction: 'SACRAMENTO COUNTY', tac: 'T30' }],
		geocodeInfo: CONFIDENT
	};

	it('puts a time limit on both questions', async () => {
		const signals: unknown[] = [];
		const fake = fakeCdtfa(asked, layer(0.06, 0.0175, 0));
		const watching = ((url: string, init?: RequestInit) => {
			signals.push(init?.signal);
			return fake(url);
		}) as typeof fetch;
		await priceAddress(HERE, watching);
		expect(signals).toHaveLength(2);
		for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
	});

	it('says so when a question runs out of time', async () => {
		const timedOut = (() =>
			Promise.reject(
				new DOMException('The operation was aborted due to timeout', 'TimeoutError')
			)) as unknown as typeof fetch;
		await expect(priceAddress(HERE, timedOut)).rejects.toThrow(
			new NoAnswer('CDTFA did not answer within 10 seconds.')
		);
	});

	it('refuses, rather than throwing something else, when the rate layer cannot be reached', async () => {
		const fake = fakeCdtfa(asked, layer(0.06, 0.0175, 0));
		const noLayer = ((url: string) =>
			url.includes('arcgis')
				? Promise.reject(new TypeError('fetch failed'))
				: fake(url)) as typeof fetch;
		await expect(priceAddress(HERE, noLayer)).rejects.toThrow(NoAnswer);
	});

	it('refuses when the rate layer answers with something that is not JSON', async () => {
		const fake = fakeCdtfa(asked, layer(0.06, 0.0175, 0));
		const garbled = ((url: string) =>
			url.includes('arcgis')
				? Promise.resolve({
						ok: true,
						status: 200,
						json: () => Promise.reject(new SyntaxError('<html>'))
					})
				: fake(url)) as unknown as typeof fetch;
		await expect(priceAddress(HERE, garbled)).rejects.toThrow(NoAnswer);
	});
});
