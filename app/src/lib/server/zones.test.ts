import { describe, expect, it } from 'vitest';
import { pickZone } from './zones.ts';

const KNOWN = new Map(
	['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Not/AZone'].map((z) => [z.toLowerCase(), z])
);

describe('pickZone', () => {
	it("gives Postgres's own spelling of a zone both it and Intl know", () => {
		expect(pickZone('America/Los_Angeles', KNOWN)).toBe('America/Los_Angeles');
		expect(pickZone('america/los_angeles', KNOWN)).toBe('America/Los_Angeles');
	});

	it('is null for nothing, an unknown zone, one too long, or one Intl does not know', () => {
		expect(pickZone('', KNOWN)).toBeNull();
		expect(pickZone('Europe/London', KNOWN)).toBeNull();
		expect(pickZone('A'.repeat(65), KNOWN)).toBeNull();
		expect(pickZone('Not/AZone', KNOWN)).toBeNull();
	});
});
