import { describe, expect, it } from 'vitest';
import { emailConfirmation, invitation, passwordChanged, passwordResetLink } from './notices.js';

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

const LINK = 'https://reckon.example.com/link#Mm9e7oVwq1Kp0bNcQkR3sT4uV5wX6yZ7aB8cD9eF0gH';
const UNTIL = new Date('2026-11-10T22:05:00Z');

describe('a password chosen with an emailed link', () => {
	it('says so, as any change of password is told', () => {
		const n = passwordChanged(AVERY, KESTREL, { at: AT, on: 'link' });
		expect(n.body).toContain('with a link reckon emailed you');
	});
});

describe('an invitation', () => {
	const n = invitation(AVERY, KESTREL, { by: 'Quinn Harper', link: LINK, until: UNTIL });

	it('carries the link, on a line of its own, and who sent it', () => {
		expect(n).toMatchObject({
			kind: 'invitation',
			to: 'avery@kestrel.example',
			subject: 'Kestrel: choose your password'
		});
		expect(n.body).toContain("Quinn Harper added you to Kestrel Field Services's reckon.");
		expect(n.body.split('\n\n')).toContain(LINK);
	});

	it('says until when it works, in their own zone, and that it works once', () => {
		expect(n.body).toContain('It works once, until Tuesday, November 10, 2026 at 2:05 PM PST.');
		expect(n.body).toContain('ask Quinn Harper or someone else with Full access');
	});

	it('names the address they sign in with', () => {
		expect(n.body).toContain('You sign in with this address, avery@kestrel.example.');
	});
});

describe('a password reset on Team', () => {
	const n = passwordResetLink(AVERY, KESTREL, {
		at: AT,
		by: 'Quinn Harper',
		link: LINK,
		until: UNTIL
	});

	it('names who reset it, that the old one stopped, and carries the link', () => {
		expect(n).toMatchObject({
			kind: 'password_reset_link',
			subject: 'Kestrel: your password was reset'
		});
		expect(n.body).toContain('Quinn Harper reset the password');
		expect(n.body).toContain('signed you out everywhere. Your old password no longer works.');
		expect(n.body.split('\n\n')).toContain(LINK);
		expect(n.body).not.toContain('temporary');
	});

	it('says what to do if they did not expect it, and how to reach the business', () => {
		expect(n.body).toContain("If you didn't expect this, ask Quinn Harper");
		expect(n.body).toContain('reach the business at office@kestrel.example or 555-0100');
	});
});

describe('confirming an address', () => {
	const n = emailConfirmation(AVERY, KESTREL, { link: LINK, until: UNTIL });

	it('carries the link, and names the address it confirms', () => {
		expect(n).toMatchObject({
			kind: 'email_confirmation',
			to: 'avery@kestrel.example',
			subject: 'Kestrel: confirm your email'
		});
		expect(n.body).toContain('confirm that avery@kestrel.example is yours');
		expect(n.body.split('\n\n')).toContain(LINK);
	});

	it('says that someone asking for it unasked is signed in as them', () => {
		expect(n.body).toContain("If you didn't ask, someone else is signed in as you.");
	});
});
