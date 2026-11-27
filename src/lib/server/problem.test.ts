import { describe, expect, it } from 'vitest';
import { PROBLEM, PROBLEM_MEDIA_TYPE, type ProblemKind } from '#lib/problem.ts';
import { problem } from './problem.ts';

const kinds = Object.keys(PROBLEM) as ProblemKind[];

describe('a problem document', () => {
	it('is sent with its kind’s one status, type and title', async () => {
		for (const kind of kinds) {
			const r = problem(kind, 'What went wrong this time.');
			expect(r.status).toBe(PROBLEM[kind].status);
			expect(r.headers.get('content-type')).toBe(PROBLEM_MEDIA_TYPE);
			expect(await r.json()).toEqual({
				type: PROBLEM[kind].type,
				title: PROBLEM[kind].title,
				status: PROBLEM[kind].status,
				detail: 'What went wrong this time.'
			});
		}
	});

	it('tells each kind from every other by its type and its title', () => {
		expect(new Set(kinds.map((k) => PROBLEM[k].type)).size).toBe(kinds.length);
		expect(new Set(kinds.map((k) => PROBLEM[k].title)).size).toBe(kinds.length);
	});

	it('is a refusal or a failure, never a success', () => {
		for (const kind of kinds) expect(PROBLEM[kind].status).toBeGreaterThanOrEqual(400);
	});

	it('tells a save that lost a race from one that looking again will not change', () => {
		expect(PROBLEM.changedMeanwhile.status).toBe(PROBLEM.notAsThingsStand.status);
		expect(PROBLEM.changedMeanwhile.type).not.toBe(PROBLEM.notAsThingsStand.type);
		expect(PROBLEM.savedSinceRead.status).toBe(412);
	});

	it('carries a collision, and the boxes refused, beside what it says', async () => {
		const r = problem('changedMeanwhile', 'Changed meanwhile.', {
			errors: { note: 'Somebody changed it.' },
			members: { conflict: { what: 'changed' } }
		});
		expect(await r.json()).toMatchObject({
			type: '/problems/changed-meanwhile',
			conflict: { what: 'changed' },
			errors: { note: 'Somebody changed it.' }
		});
	});
});
