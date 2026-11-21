import { describe, expect, it } from 'vitest';
import { parseAreaField, parseFrom, parsePieces } from './area-fields.ts';

const reno = [
	{ level: 'state', jurisdiction: 'Nevada', rate_pct: '6.85' },
	{ level: 'local', jurisdiction: 'Washoe County', rate_pct: '1.415' }
];

describe('an area as a person types it', () => {
	it('needs what the state calls it, and takes its code where there is one', () => {
		expect(parseAreaField('name', '  ')).toEqual({ ok: false, why: 'What the state calls it.' });
		expect(parseAreaField('name', 'Reno')).toEqual({ ok: true, value: 'Reno' });
		expect(parseAreaField('code', '')).toEqual({ ok: true, value: null });
		expect(parseAreaField('rate_pct', '8')).toMatchObject({ ok: false });
	});

	it('needs the day its rate took effect, a day there is', () => {
		expect(parseFrom('2026-10-01')).toEqual({ ok: true, value: '2026-10-01' });
		expect(parseFrom('')).toMatchObject({ ok: false });
		expect(parseFrom('2026-02-30')).toMatchObject({ ok: false });
	});
});

describe('a rate, piece by piece', () => {
	it('takes the state’s share and the local ones', () => {
		const { pieces, errors } = parsePieces(reno, 'NV');
		expect(errors).toEqual({});
		expect(pieces).toEqual([
			{ level: 'state', jurisdiction: 'Nevada', code: null, rate_pct: '6.85', sale_kind_id: null },
			{
				level: 'local',
				jurisdiction: 'Washoe County',
				code: null,
				rate_pct: '1.415',
				sale_kind_id: null
			}
		]);
	});

	it('takes a piece for one kind of sale alone, once more from one who levies on every kind', () => {
		// Richmond levies its local sales tax, and a meals tax of its own.
		const MEALS = '019a0000-0000-7000-8000-00000000000c';
		const richmond = [
			{ level: 'state', jurisdiction: 'Virginia', rate_pct: '4.3' },
			{ level: 'local', jurisdiction: 'Richmond', rate_pct: '1' },
			{ level: 'local', jurisdiction: 'Richmond', rate_pct: '7.5', sale_kind_id: MEALS }
		];
		const { pieces, errors } = parsePieces(richmond, 'VA');
		expect(errors).toEqual({});
		expect(pieces.map((p) => p.sale_kind_id)).toEqual([null, null, MEALS]);
		expect(parsePieces([...richmond, richmond[2]], 'VA').errors).toEqual({
			'pieces.3.jurisdiction': 'Each levies once on a kind.'
		});
		expect(
			parsePieces([...richmond, { ...richmond[0], jurisdiction: 'VA', sale_kind_id: MEALS }], 'VA')
				.errors
		).toEqual({});
		expect(
			parsePieces([...richmond, { ...richmond[2], sale_kind_id: 'meals' }], 'VA').errors[
				'pieces.3.sale_kind_id'
			]
		).toBeDefined();
	});

	it('needs a piece, and no more than a place has', () => {
		expect(parsePieces([], 'NV').errors).toEqual({
			pieces: 'Who levies what: at least one piece.'
		});
		expect(parsePieces('6.85', 'NV').errors.pieces).toBeDefined();
		expect(parsePieces(Array(13).fill(reno[1]), 'NV').errors.pieces).toBe('At most 12 pieces.');
	});

	it('says which box of which piece is wrong', () => {
		const { errors } = parsePieces(
			[reno[0], { level: 'county', jurisdiction: '', rate_pct: '1.41555' }],
			'NV'
		);
		expect(Object.keys(errors).sort()).toEqual([
			'pieces.1.jurisdiction',
			'pieces.1.level',
			'pieces.1.rate_pct'
		]);
		expect(errors['pieces.1.rate_pct']).toBe('At most 4 decimal places.');
	});

	it('takes a rate as a percentage under 100', () => {
		expect(
			parsePieces([{ level: 'local', jurisdiction: 'Reno', rate_pct: '100' }], 'NV').errors
		).toEqual({ 'pieces.0.rate_pct': 'A percentage under 100: 4.6 for 4.6%.' });
		expect(
			parsePieces([{ level: 'local', jurisdiction: 'Reno', rate_pct: '-1' }], 'NV').errors[
				'pieces.0.rate_pct'
			]
		).toBeDefined();
	});

	it('has the state levy once, and a state with no tax of its own not at all', () => {
		expect(parsePieces([reno[0], reno[0]], 'NV').errors).toEqual({
			'pieces.1.level': 'The state levies once.'
		});
		expect(
			parsePieces([{ level: 'state', jurisdiction: 'Alaska', rate_pct: '1' }], 'AK').errors
		).toEqual({ 'pieces.0.level': 'Alaska levies no sales tax of its own: its pieces are local.' });
		expect(
			parsePieces([{ level: 'local', jurisdiction: 'Juneau', rate_pct: '5' }], 'AK').errors
		).toEqual({});
	});

	it('has each jurisdiction levy once, however it is written', () => {
		expect(
			parsePieces([reno[0], reno[1], { ...reno[1], jurisdiction: 'WASHOE COUNTY' }], 'NV').errors
		).toEqual({ 'pieces.2.jurisdiction': 'Each levies once in a rate.' });
	});

	it('refuses a rate of nothing, which is no tax', () => {
		expect(
			parsePieces([{ level: 'local', jurisdiction: 'Reno', rate_pct: '0' }], 'NV').errors
		).toEqual({ pieces: 'A rate of nothing is no tax: a place with none needs no area.' });
	});
});
