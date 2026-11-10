import { describe, expect, it } from 'vitest';
import {
	LOGO_CID,
	buttonColours,
	contrast,
	escaped,
	laidOut,
	mailableLogo
} from './email-layout.js';

const LINK = 'https://reckon.example.com/link#Mm9e7oVwq1Kp0bNcQkR3sT4uV5wX6yZ7aB8cD9eF0gH';
const email = (look = {}) =>
	laidOut({
		subject: 'Kestrel: choose your password',
		heading: 'Welcome to Kestrel Field Services',
		blocks: [
			{ text: 'Hello Rowan <Pike>,' },
			{ text: 'Choose the password you’ll sign in with, at this link:' },
			{ link: LINK, label: 'Choose your password' },
			{ text: 'It works once.' }
		],
		look: { name: 'Kestrel & Co', email: 'office@kestrel.example', ...look }
	});

describe('an email laid out', () => {
	it('says the same in its text as in its HTML, the link on a line of its own', () => {
		const { text, html } = email();
		expect(text.split('\n\n')).toEqual([
			'Hello Rowan <Pike>,',
			'Choose the password you’ll sign in with, at this link:',
			LINK,
			'It works once.',
			'— Kestrel & Co · office@kestrel.example'
		]);
		expect(html).toContain('Choose the password you’ll sign in with, at this link:');
		expect(html).toContain('It works once.');
	});

	it('escapes whatever it is given before it goes into the HTML', () => {
		const { html } = email();
		expect(html).toContain('Hello Rowan &lt;Pike&gt;,');
		expect(html).not.toContain('<Pike>');
		expect(html).toContain('Kestrel &amp; Co');
	});

	it('names its language and direction on the page and on its content, and its subject as the title', () => {
		const { html } = email();
		expect(html).toMatch(/<html lang="en" dir="ltr"/);
		expect(html).toMatch(
			/<div role="article" aria-roledescription="email" aria-label="Kestrel: choose your password" lang="en" dir="ltr"/
		);
		expect(html).toContain('<title>Kestrel: choose your password</title>');
		expect(html).toContain('<h1 ');
	});

	it('marks every table as layout, not data', () => {
		const { html } = email();
		const tables = html.match(/<table\b[^>]*>/g) ?? [];
		expect(tables.length).toBeGreaterThan(0);
		for (const t of tables) expect(t).toContain('role="presentation"');
	});

	it('draws a link as a button saying where it goes, with the address spelled out under it', () => {
		const { html } = email();
		expect(html).toContain('>Choose your password</a>');
		expect(html).toContain(`>${LINK}</a>`);
		expect(html.match(new RegExp(`href="${LINK.replace(/[.?]/g, '\\$&')}"`, 'g'))).toHaveLength(2);
	});

	it('declares light and dark, for the programs that honour it', () => {
		const { html } = email();
		expect(html).toContain('<meta name="color-scheme" content="light dark">');
		expect(html).toContain('@media (prefers-color-scheme: dark)');
	});

	it('shows the business’s name at the top without a logo, and the logo carried inline with one', () => {
		expect(email().html).not.toContain(`cid:${LOGO_CID}`);
		const { html } = email({ logo: { width: 360, height: 96 } });
		expect(html).toContain(`src="cid:${LOGO_CID}" alt="Kestrel &amp; Co"`);
		// Drawn 40 high, and as wide as that makes it, for Outlook's width attribute.
		expect(html).toContain('height="40" width="150"');
	});
});

describe('the button’s colours', () => {
	it('puts white on a dark accent, and near-black on a light one, each at 4.5:1 or better', () => {
		expect(buttonColours('#0f5132')).toEqual({ ground: '#0f5132', words: '#ffffff' });
		const light = buttonColours('#ffd33d');
		expect(light.words).toBe('#1f2328');
		for (const accent of ['#0f5132', '#ffd33d', '#1d6f9c', '#00ff00', '#808080', '#ff0000']) {
			const { ground, words } = buttonColours(accent);
			expect(contrast(ground, words)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('reaches 4.5:1 on every one of the 4,096 colours of a 16-step grid', () => {
		const steps = Array.from({ length: 16 }, (_, i) => (i * 17).toString(16).padStart(2, '0'));
		for (const r of steps)
			for (const g of steps)
				for (const b of steps) {
					const { ground, words } = buttonColours(`#${r}${g}${b}`);
					expect(contrast(ground, words)).toBeGreaterThanOrEqual(4.5);
				}
	});

	it('uses reckon’s own accent where the business has none, or one that is not #rrggbb', () => {
		expect(buttonColours(null).ground).toBe('#1d6f9c');
		expect(buttonColours('red').ground).toBe('#1d6f9c');
	});

	it('measures contrast as WCAG does', () => {
		expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
	});
});

describe('a logo in an email', () => {
	it('travels only as a PNG or a JPEG, which every mail program draws', () => {
		const png = Uint8Array.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1,
			0x68, 0, 0, 0, 0x60
		]);
		expect(mailableLogo(png, 'image/png')).toEqual({ width: 360, height: 96 });
		expect(mailableLogo(png, 'image/svg+xml')).toBeNull();
		expect(mailableLogo(png, 'image/webp')).toBeNull();
		expect(mailableLogo(null, 'image/png')).toBeNull();
	});
});

describe('escaping', () => {
	it('encodes the five characters HTML treats as markup', () => {
		expect(escaped(`<a href="x" title='y'>&</a>`)).toBe(
			'&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
		);
	});
});
