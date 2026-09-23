import { describe, expect, it } from 'vitest';
import { NoAnswer, priceAddress } from './cdtfa';

/**
 * The contract with CDTFA, tested against a fetcher that answers the way CDTFA
 * does -- including the ways it answers badly.
 *
 * This is the one module whose wrong answer becomes a wrong invoice, and every
 * refusal it makes was put there by something that actually happened. Each
 * case below is one of those.
 *
 * Tax area codes differ between tests on purpose: splitFor() memoises by TAC
 * for the life of the process, so reusing one would have a later test read an
 * earlier test's answer and pass for the wrong reason.
 */

const HERE = { street: '36005 CA-99 N', city: 'Traver', postcode: '93673' };

/** A geocode CDTFA is sure about. */
const CONFIDENT = {
	confidence: 'High',
	matchCodes: ['Good'],
	formattedAddress: '36005 CA-99 N, Traver, CA 93673'
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
					taxRateInfo: [{ rate: 0.0775, jurisdiction: 'TULARE COUNTY', tac: 'T01' }],
					geocodeInfo: CONFIDENT
				},
				layer(0.06, 0.0175, 0)
			)
		);
		expect(answer).toMatchObject({
			rate: '7.7500',
			state: '6.0000',
			district: '1.7500',
			jurisdiction: 'TULARE COUNTY',
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
					taxRateInfo: [{ rate: 0.0725, jurisdiction: 'KINGS COUNTY', tac: 'T02' }],
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
					taxRateInfo: [{ rate: 0.0875, jurisdiction: 'VISALIA', tac: 'T03' }],
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
	// in Kettleman billing a rate from three hundred miles away.
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
	 * They were two tests until a mutation run showed why that is not enough:
	 * deleting the confidence clause outright left both of them passing,
	 * because their geocode was ALSO marked Ambiguous and the next clause
	 * caught it. A test that passes for a reason other than the one it names
	 * is a test that will keep passing when that reason goes away.
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
						taxRateInfo: [{ rate: 0.0775, jurisdiction: 'TULARE COUNTY', tac: `T1${_why.length}` }],
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
						taxRateInfo: [{ rate: 0.0775, jurisdiction: 'TULARE COUNTY', tac: 'T06' }],
						geocodeInfo: {
							confidence: 'High',
							matchCodes: ['Good', 'UpHierarchy'],
							formattedAddress: 'Tulare County'
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
							{ rate: 0.0775, jurisdiction: 'TULARE COUNTY', tac: 'T07' },
							{ rate: 0.0875, jurisdiction: 'VISALIA', tac: 'T08' }
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
						taxRateInfo: [{ rate: 0.0775, jurisdiction: 'TULARE COUNTY', tac: 'T09' }],
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

		await expect(priceAddress({ street: '36005 CA-99 N', city: 'Traver' }, never)).rejects.toThrow(
			/postcode/
		);
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
