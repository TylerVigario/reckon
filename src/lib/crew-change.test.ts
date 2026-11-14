import { describe, expect, it } from 'vitest';
import { crewChange } from './crew-change.ts';

describe('who a save changes on a crew', () => {
	it('is who left and who joined, and no one else', () => {
		expect(crewChange(['avery', 'sam', 'jordan'], ['avery', 'jordan', 'robin'])).toEqual({
			gone: ['sam'],
			joined: ['robin']
		});
	});

	it('is nobody where the crew is the same, in any order', () => {
		expect(crewChange(['avery', 'sam'], ['sam', 'avery'])).toEqual({ gone: [], joined: [] });
	});

	it('is everyone, going from a team to one person, or from one to a team', () => {
		expect(crewChange(['avery', 'sam'], [])).toEqual({ gone: ['avery', 'sam'], joined: [] });
		expect(crewChange([], ['avery', 'sam'])).toEqual({ gone: [], joined: ['avery', 'sam'] });
	});
});
