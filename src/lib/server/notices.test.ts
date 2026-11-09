import { describe, expect, it } from 'vitest';
import { passwordChanged, passwordReset } from './notices.js';

const AVERY = {
	name: 'Avery Lind',
	email: 'avery@kestrel.example',
	timezone: 'America/Los_Angeles',
	locale: 'en-US'
};
const KESTREL = {
	tradingName: 'Kestrel Field Services',
	shortName: 'Kestrel',
	email: 'office@kestrel.example',
	phone: '555-0100',
	timezone: 'UTC',
	locale: 'en-GB'
};
const AT = new Date('2026-11-09T22:05:00Z');

describe('a password changed', () => {
	it('is told to them, saying when in their own zone and words, and where', () => {
		const n = passwordChanged(AVERY, KESTREL, { at: AT, on: 'profile' });
		expect(n).toMatchObject({
			kind: 'password_changed',
			to: 'avery@kestrel.example',
			subject: 'Kestrel: your password was changed'
		});
		expect(n.body).toContain('Hello Avery Lind,');
		expect(n.body).toContain('Monday, November 9, 2026 at 2:05 PM PST');
		expect(n.body).toContain('on Your profile');
	});

	it('says what to do if it was not them, and how to reach the business', () => {
		const n = passwordChanged(AVERY, KESTREL, { at: AT, on: 'command_line' });
		expect(n.body).toContain('Ask someone with Full access at Kestrel Field Services');
		expect(n.body).toContain('reach the business at office@kestrel.example or 555-0100');
	});

	it('follows the business’s zone and locale where they have none, and reckon’s name where it has none', () => {
		const n = passwordChanged(
			{ name: 'Sam Ortega', email: 'sam@kestrel.example' },
			{ timezone: 'UTC', locale: 'en-GB' },
			{ at: AT, on: 'chosen' }
		);
		expect(n.subject).toBe('reckon: your password was changed');
		expect(n.body).toMatch(/9 November 2026 at 22:05 UTC/);
		expect(n.body).toContain('sign in to reckon with');
		expect(n.body).toContain('Ask someone with Full access to reset it on Team.');
		expect(n.body).not.toContain('reach the business');
	});

	it('still reads in a zone or locale it does not know', () => {
		const n = passwordChanged(
			{ ...AVERY, timezone: 'Nowhere/Atlantis', locale: 'xx-invalid-!!' },
			KESTREL,
			{ at: AT, on: 'profile' }
		);
		expect(n.body).toContain('2026');
	});
});

describe('a password reset on Team', () => {
	it('names who reset it, and that they hold a temporary one to hand over', () => {
		const n = passwordReset(AVERY, KESTREL, { at: AT, by: 'Quinn Harper' });
		expect(n).toMatchObject({
			kind: 'password_reset',
			subject: 'Kestrel: your password was reset'
		});
		expect(n.body).toContain('Quinn Harper reset the password');
		expect(n.body).toContain('signed you out everywhere');
		expect(n.body).toContain('a temporary password to hand you');
	});
});
