import { describe, expect, it } from 'vitest';
import { standing, type Waiting } from './people-fields.ts';

const NEW = {
	active: true,
	last_signed_in_at: null,
	has_passkey: false,
	waiting: null
};
const link = (purpose: Waiting['purpose'], lapsed: boolean): Waiting => ({
	purpose,
	sent_at: '2026-11-09T18:00:00Z',
	until: '2026-11-10T18:00:00Z',
	lapsed
});

describe('where someone stands on Team', () => {
	it('is Invited while the link to make their first passkey works', () => {
		expect(standing({ ...NEW, waiting: link('invite', false) })).toBe('invited');
	});

	it('is Invitation expired once it lapses unused', () => {
		expect(standing({ ...NEW, waiting: link('invite', true) })).toBe('expired');
	});

	it('is Not invited with no passkey and no invitation ever sent', () => {
		expect(standing(NEW)).toBe('uninvited');
	});

	it('is Active once they have a passkey, or have signed in', () => {
		expect(standing({ ...NEW, has_passkey: true })).toBe('active');
		expect(standing({ ...NEW, last_signed_in_at: '2026-11-09T18:00:00Z' })).toBe('active');
	});

	it('stays Active through a reset, its link waiting or lapsed', () => {
		const joined = { ...NEW, last_signed_in_at: '2026-11-09T18:00:00Z' };
		expect(standing({ ...joined, waiting: link('reset', false) })).toBe('active');
		expect(standing({ ...joined, waiting: link('reset', true) })).toBe('active');
	});

	it('is Deactivated whatever else is true', () => {
		expect(standing({ ...NEW, active: false, waiting: link('invite', false) })).toBe('deactivated');
	});
});
