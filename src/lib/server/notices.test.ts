import { describe, expect, it } from 'vitest';
import {
	emailChange,
	emailChanging,
	emailConfirmation,
	invitation,
	newPasskeyLink,
	passkeyAdded,
	passkeyRemoved,
	passkeysEnded
} from './notices.js';
import { contactFor } from './contact.js';

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

describe('a notice', () => {
	const added = { name: 'Google Password Manager', at: AT, from: null };

	it('is told to them, saying when in their own zone and words', () => {
		const n = passkeyAdded(AVERY, KESTREL, added);
		expect(n.body).toContain('Hello Avery Lind,');
		expect(n.body).toContain('Monday, November 9, 2026 at 2:05 PM PST');
		expect(n.body).not.toContain('Full access');
	});

	it('follows the business’s zone and locale where they have none, and reckon’s name where it has none', () => {
		const n = passkeyAdded(
			{ name: 'Sam Ortega', email: 'sam@kestrel.example' },
			{ timezone: 'UTC', locale: 'en-GB' },
			added
		);
		expect(n.subject).toBe('reckon: a passkey was added');
		expect(n.body).toMatch(/9 November 2026 at 22:05 UTC/);
		expect(n.body).toContain('sign in to reckon with');
		expect(n.body).toContain('Contact your administrator to have it ended.');
	});

	it('still reads in a zone or locale it does not know', () => {
		const n = passkeyAdded(
			{ ...AVERY, timezone: 'Nowhere/Atlantis', locale: 'xx-invalid-!!' },
			KESTREL,
			added
		);
		expect(n.body).toContain('2026');
	});
});

const LINK = 'https://reckon.example.com/link#Mm9e7oVwq1Kp0bNcQkR3sT4uV5wX6yZ7aB8cD9eF0gH';
const UNTIL = new Date('2026-11-10T22:05:00Z');

describe('an invitation', () => {
	const n = invitation(AVERY, KESTREL, { by: 'Quinn Harper', link: LINK, until: UNTIL });

	it('carries the link, on a line of its own, and who sent it', () => {
		expect(n).toMatchObject({
			kind: 'invitation',
			to: 'avery@kestrel.example',
			subject: 'Kestrel: make your passkey'
		});
		expect(n.body).toContain("Quinn Harper added you to Kestrel Field Services's reckon.");
		expect(n.body.split('\n\n')).toContain(LINK);
	});

	it('says what a passkey is, and that there is no password', () => {
		expect(n.body).toContain(
			'your phone or computer keeps it, and your fingerprint, face or screen lock unlocks it, so there is no password to choose or remember.'
		);
	});

	it('says until when it works, in their own zone, and that it works once', () => {
		expect(n.body).toContain('It works once, until Tuesday, November 10, 2026 at 2:05 PM PST.');
		expect(n.body).toContain('If it lapses, ask Quinn Harper to send another.');
	});

	it('names the address they sign in with', () => {
		expect(n.body).toContain('You sign in with this address, avery@kestrel.example.');
	});
});

describe('a new link sent on Team', () => {
	const n = newPasskeyLink(AVERY, KESTREL, {
		at: AT,
		by: 'Quinn Harper',
		ended: false,
		link: LINK,
		until: UNTIL
	});

	it('names who sent it, says their passkeys still work, and carries the link', () => {
		expect(n).toMatchObject({
			kind: 'passkey_link',
			subject: 'Kestrel: a link to make a new passkey'
		});
		expect(n.body).toContain('Quinn Harper sent you this link on');
		expect(n.body).toContain('The passkeys you have still work.');
		expect(n.body).not.toContain('ended');
		expect(n.body.split('\n\n')).toContain(LINK);
		expect(n.body).not.toContain('temporary');
	});

	it('sent for a phone or computer lost or stolen, says their passkeys were ended as it went', () => {
		const lost = newPasskeyLink(AVERY, KESTREL, {
			at: AT,
			by: 'Quinn Harper',
			ended: true,
			link: LINK,
			until: UNTIL
		});
		expect(lost.body).toContain(
			"The passkeys you had were ended as it was sent, and you were signed out everywhere, so a lost or stolen phone or computer can't sign in as you."
		);
		expect(lost.body).not.toContain('still work');
	});

	it('says what to do if they did not expect it, and how to reach the business', () => {
		expect(n.body).toContain(
			"If you didn't expect this, ask Quinn Harper about it, or contact Kestrel Field Services at office@kestrel.example or 555-0100."
		);
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

describe('a change of address, to the new one', () => {
	const NEW = 'avery.lind@fieldmail.example';
	const n = emailChange(AVERY, KESTREL, { by: 'Sam Ortiz', link: LINK, until: UNTIL, to: NEW });

	it('goes to the new address, carrying the link and who asked', () => {
		expect(n).toMatchObject({
			kind: 'email_change',
			to: NEW,
			subject: 'Kestrel: confirm your new email'
		});
		expect(n.body).toContain(`Sam Ortiz is changing the email you sign in to`);
		expect(n.body).toContain(`to this one, ${NEW}`);
		expect(n.body.split('\n\n')).toContain(LINK);
		expect(n.body).toContain('It works once, until');
	});

	it('never says the address they have now, which a mistyped one would reach', () => {
		expect(n.body).not.toContain(AVERY.email);
		expect(n.body).toContain('you keep signing in with your old address');
	});

	it('tells anyone it reached by mistake that nothing changes, and how to reach the business', () => {
		expect(n.body).toContain(
			"If you aren't Avery Lind, this address was given by mistake, and nothing changes unless the link is used."
		);
		expect(n.body).toContain('office@kestrel.example or 555-0100');
	});

	it('says it was theirs to ask for where they asked for it themselves', () => {
		const own = emailChange(AVERY, KESTREL, { by: null, link: LINK, until: UNTIL, to: NEW });
		expect(own.body).toContain('You are changing the email');
		expect(own.body).toContain('send another from Team');
	});
});

describe('a change of address, to the old one', () => {
	const NEW = 'avery.lind@fieldmail.example';
	const n = emailChanging(AVERY, KESTREL, { at: AT, by: 'Sam Ortiz', to: NEW });

	it('goes to the address they have, saying who asked, when, and for what', () => {
		expect(n).toMatchObject({
			kind: 'email_changing',
			to: 'avery@kestrel.example',
			subject: 'Kestrel: your sign-in email is changing'
		});
		expect(n.body).toContain('Monday, November 9, 2026 at 2:05 PM PST, Sam Ortiz asked');
		expect(n.body).toContain(`from this one to ${NEW}`);
		expect(n.body).toContain("until it's used you keep signing in with this one");
	});

	it('carries no link, and says whom to ask to cancel it', () => {
		expect(n.body).not.toContain('/link');
		expect(n.body).toContain(
			'ask Sam Ortiz to cancel it, or contact Kestrel Field Services at office@kestrel.example or 555-0100.'
		);
	});

	it('where they asked for it themselves, says someone else may be signed in as them', () => {
		const own = emailChanging(AVERY, KESTREL, { at: AT, by: null, to: NEW });
		expect(own.body).toContain(', you asked for the email');
		expect(own.body).toContain("If you didn't, someone else is signed in as you.");
	});
});

describe('every notice', () => {
	const UNTIL_ = new Date('2026-11-10T22:05:00Z');
	const all = [
		passkeyAdded(AVERY, KESTREL, { name: 'iCloud Keychain', at: AT, from: 'Safari on iPhone' }),
		invitation(AVERY, KESTREL, { by: 'Sam Ortiz', link: LINK, until: UNTIL_ }),
		newPasskeyLink(AVERY, KESTREL, {
			at: AT,
			by: 'Sam Ortiz',
			ended: false,
			link: LINK,
			until: UNTIL_
		}),
		emailConfirmation(AVERY, KESTREL, { link: LINK, until: UNTIL_ }),
		emailChange(AVERY, KESTREL, { by: 'Sam Ortiz', link: LINK, until: UNTIL_, to: 'a@b.example' }),
		emailChanging(AVERY, KESTREL, { at: AT, by: 'Sam Ortiz', to: 'a@b.example' }),
		passkeysEnded(AVERY, KESTREL, { at: AT, by: 'Sam Ortiz' })
	];

	it('goes as HTML as well as text, its subject the title and every paragraph in both', () => {
		for (const n of all) {
			expect(n.html).toContain(`<title>${n.subject}</title>`);
			for (const para of n.body.split('\n\n').slice(0, -1)) {
				const html = para
					.replaceAll('&', '&amp;')
					.replaceAll('<', '&lt;')
					.replaceAll('>', '&gt;')
					.replaceAll("'", '&#39;');
				expect(n.html).toContain(html);
			}
		}
	});

	it('signs off with the business and how to reach it', () => {
		for (const n of all)
			expect(n.body.split('\n\n').at(-1)).toBe(
				'— Kestrel Field Services · office@kestrel.example · 555-0100'
			);
	});

	it('draws each link as a button saying where it goes', () => {
		expect(all[1].html).toContain('>Make your passkey</a>');
		expect(all[2].html).toContain('>Make a new passkey</a>');
		expect(all[3].html).toContain('>Confirm your email</a>');
		expect(all[4].html).toContain('>Confirm your new email</a>');
	});
});

describe('whom to contact', () => {
	it('is never a level of access, in any email reckon sends', () => {
		for (const n of [
			passkeyAdded(AVERY, KESTREL, { name: null, at: AT, from: null }),
			passkeyRemoved(AVERY, KESTREL, { name: null, at: AT, from: null }),
			invitation(AVERY, KESTREL, { by: 'Quinn Harper', link: LINK, until: UNTIL }),
			newPasskeyLink(AVERY, KESTREL, {
				at: AT,
				by: 'Quinn Harper',
				ended: true,
				link: LINK,
				until: UNTIL
			}),
			emailConfirmation(AVERY, KESTREL, { link: LINK, until: UNTIL }),
			emailChange(AVERY, KESTREL, { by: 'Sam Ortiz', link: LINK, until: UNTIL, to: 'a@b.example' }),
			emailChanging(AVERY, KESTREL, { at: AT, by: 'Sam Ortiz', to: 'a@b.example' }),
			emailChanging(AVERY, KESTREL, { at: AT, by: null, to: 'a@b.example' }),
			passkeysEnded(AVERY, KESTREL, { at: AT, by: 'Quinn Harper' }),
			passkeysEnded(AVERY, KESTREL, { at: AT, by: null })
		])
			expect(n.body, n.kind).not.toMatch(/with Full/i);
	});

	it('is the business by the way it is reached, or their administrator where it gives none', () => {
		expect(contactFor(KESTREL)).toBe(
			'Kestrel Field Services at office@kestrel.example or 555-0100'
		);
		expect(contactFor({ ...KESTREL, email: null })).toBe('Kestrel Field Services at 555-0100');
		expect(contactFor({ email: 'office@kestrel.example' })).toBe(
			'the business at office@kestrel.example'
		);
		expect(contactFor({ tradingName: 'Kestrel Field Services', email: ' ', phone: null })).toBe(
			'your administrator'
		);
	});
});

describe('a passkey added', () => {
	const n = passkeyAdded(AVERY, KESTREL, {
		name: 'Google Password Manager',
		at: AT,
		from: 'Chrome on Android'
	});

	it('names the passkey, when and where from, in their own zone', () => {
		expect(n).toMatchObject({
			kind: 'passkey_added',
			to: 'avery@kestrel.example',
			subject: 'Kestrel: a passkey was added'
		});
		expect(n.body).toContain(
			"A passkey, Google Password Manager, was added to the account you sign in to Kestrel Field Services's reckon with, on Monday, November 9, 2026 at 2:05 PM PST, from Chrome on Android."
		);
	});

	it('says whom to contact if it was not them', () => {
		expect(n.body).toContain(`Contact ${contactFor(KESTREL)} to have it ended.`);
	});

	it('leaves one with no name, and no manager that says, unnamed', () => {
		expect(passkeyAdded(AVERY, KESTREL, { name: null, at: AT, from: null }).body).toContain(
			"A passkey was added to the account you sign in to Kestrel Field Services's reckon with, on Monday, November 9, 2026 at 2:05 PM PST. It can sign you in from now on."
		);
	});
});

describe('a passkey removed', () => {
	it('names the passkey and when, and whom to contact', () => {
		const n = passkeyRemoved(AVERY, KESTREL, { name: 'iCloud Keychain', at: AT, from: null });
		expect(n).toMatchObject({ kind: 'passkey_removed', subject: 'Kestrel: a passkey was removed' });
		expect(n.body).toContain(
			"A passkey, iCloud Keychain, was removed from the account you sign in to Kestrel Field Services's reckon with, on Monday, November 9, 2026 at 2:05 PM PST. It no longer signs you in."
		);
		expect(n.body).toContain(`Contact ${contactFor(KESTREL)}.`);
	});
});

describe('passkeys ended', () => {
	it('on Team, names who ended them and when, and whom to ask for a new link', () => {
		const n = passkeysEnded(AVERY, KESTREL, { at: AT, by: 'Quinn Harper' });
		expect(n).toMatchObject({
			kind: 'passkeys_ended',
			subject: 'Kestrel: your passkeys were ended'
		});
		expect(n.body).toContain(
			"Quinn Harper ended the passkeys you sign in to Kestrel Field Services's reckon with on Monday, November 9, 2026 at 2:05 PM PST, and you were signed out everywhere, so a lost or stolen phone or computer can't sign in as you."
		);
		expect(n.body).toContain(
			'To sign in again, ask Quinn Harper to send you a new link to make a passkey with.'
		);
		expect(n.body).toContain(`ask Quinn Harper about it, or contact ${contactFor(KESTREL)}.`);
	});

	it('from the command line, names nobody, and says whom to contact', () => {
		const n = passkeysEnded(AVERY, KESTREL, { at: AT, by: null });
		expect(n.body).toContain(
			"The passkeys you sign in to Kestrel Field Services's reckon with were ended on Monday"
		);
		expect(n.body).toContain(`Contact ${contactFor(KESTREL)} for one`);
	});
});
