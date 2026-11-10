// How every email reckon sends is laid out: one layout, written by hand, and each
// email built from the same blocks for its HTML and its plain text, so the two
// say the same thing (a text part that differs from its HTML is itself a spam
// signal: SpamAssassin's MPART_ALT_DIFF). Plain JavaScript, as notices.js is,
// so scripts/user.mjs lays out what it sends the same way.
//
// THE HTML is for every mail program, the oldest included: classic Outlook for
// Windows draws with Word, which takes padding only on table cells and ignores
// max-width, border-radius, custom properties, flex and grid, and Gmail drops a
// <style> it does not like (caniemail.com). So the layout is tables, marked
// role="presentation" so a screen reader does not announce them as data, every
// style is written on its element, and the fonts are the system's. A <style>
// in the head only adds dark colours where a program honours them (Apple Mail,
// Outlook on the web and on phones); Gmail and Outlook for Windows invert
// colours their own way, so the light ones are chosen to survive that.
//
// Accessibility after the Email Markup Consortium and WCAG 2.2, which applies
// to email (WCAG2ICT): the language and direction on the content as well as on
// <html>, since some programs strip the latter; the subject as the <title>;
// one heading saying what the email is about; 4.5:1 contrast for every text,
// the button's included; a button whose words say where it goes, with the link
// spelled out in full under it, as GOV.UK asks ("spell out any web addresses
// (URLs) in full"); the business's logo with its name as the alt text, on a
// light backing where a program goes dark, since a logo is drawn for a light
// page; and nothing said only in an image. On a phone the card's padding
// narrows, where the program reads media queries.
//
// Every value is HTML-escaped where it goes into the HTML (OWASP's XSS
// Prevention Cheat Sheet): a person's name, an address, the business's own
// details.

import { jpegSize, pngSize } from './image-size.js';

/**
 * What an email says, in order: a paragraph, or a link -- a button in HTML,
 * with the address under it; the address on a line of its own in text.
 *
 * @typedef {{ text: string } | { link: string, label: string }} Block
 */

/**
 * The business, as the layout draws it: its name, how to reach it, its colour,
 * and whether it has a logo a mail program can show -- PNG or JPEG, carried in
 * the message (cid:LOGO_CID) rather than fetched, so it shows with images
 * blocked from the web and nobody learns the email was opened. Its size is in
 * pixels, so classic Outlook, which reads only the width attribute, draws it at
 * the size the rest do.
 *
 * @typedef {object} Look
 * @property {string} name
 * @property {string | null} [email]
 * @property {string | null} [phone]
 * @property {string | null} [accent] #rrggbb
 * @property {{ width: number, height: number } | null} [logo]
 */

/**
 * Whether a logo can travel in an email, and its size: a PNG or a JPEG. Mail
 * programs draw little else -- Gmail and Outlook show no SVG, and classic
 * Outlook no WebP (caniemail.com) -- so any other logo leaves the business's
 * name in its place.
 *
 * @param {Uint8Array | null | undefined} bytes
 * @param {string | null | undefined} mediaType
 * @returns {{ width: number, height: number } | null}
 */
export function mailableLogo(bytes, mediaType) {
	if (!bytes) return null;
	if (mediaType === 'image/png') return pngSize(bytes);
	if (mediaType === 'image/jpeg') return jpegSize(bytes);
	return null;
}

/** The Content-ID the business's logo travels under (RFC 2392). */
export const LOGO_CID = 'logo@reckon';

/** reckon's own accent, where the business has set none. */
const ACCENT = '#1d6f9c';

/** How tall the logo is drawn. */
const LOGO_HEIGHT = 40;

/** The font stack Primer uses: each system's own. */
const FONT =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";

/** Light colours, from Primer's: each reads at 4.5:1 or better on its ground. */
const LIGHT = {
	ground: '#f6f8fa',
	card: '#ffffff',
	line: '#d1d9e0',
	ink: '#1f2328',
	muted: '#59636e',
	link: '#0969da'
};

/** The same, dark, for the programs that ask for them. */
const DARK = {
	ground: '#0d1117',
	card: '#151b23',
	line: '#3d444d',
	ink: '#f0f6fc',
	muted: '#9198a1',
	link: '#4493f8'
};

/** Text made safe to put in HTML, between tags or in a quoted attribute. */
export const escaped = (/** @type {string} */ s) =>
	s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

/** WCAG 2.2's relative luminance of a #rrggbb colour. */
function luminance(/** @type {string} */ hex) {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2's contrast ratio between two #rrggbb colours. */
export function contrast(/** @type {string} */ a, /** @type {string} */ b) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * The button's colours: the business's accent behind words in white, or in
 * near-black where white would read at less than 4.5:1, or in black where even
 * that would not. Black always does when white does not: the two contrasts
 * multiply to 21, so white under 4.5 leaves black over 4.6.
 */
export function buttonColours(/** @type {string | null | undefined} */ accent) {
	const ground = accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : ACCENT;
	const words =
		contrast(ground, '#ffffff') >= 4.5
			? '#ffffff'
			: contrast(ground, LIGHT.ink) >= 4.5
				? LIGHT.ink
				: '#000000';
	return { ground, words };
}

/** How the business can be reached, as one line, or ''. */
const reach = (/** @type {Look} */ look) => [look.email, look.phone].filter(Boolean).join(' · ');

/**
 * An email, laid out: its plain text, and its HTML.
 *
 * @param {object} email
 * @param {string} email.subject also the HTML's title
 * @param {string} email.heading what it is about, in a few words
 * @param {Block[]} email.blocks
 * @param {Look} email.look
 * @param {string} [email.lang] a BCP 47 tag, the reader's or the business's
 * @param {'ltr' | 'rtl'} [email.dir]
 * @returns {{ text: string, html: string }}
 */
export function laidOut({ subject, heading, blocks, look, lang = 'en', dir = 'ltr' }) {
	const footer = [look.name, reach(look)].filter(Boolean).join(' · ');
	const text = [...blocks.map((b) => ('text' in b ? b.text : b.link)), `— ${footer}`].join('\n\n');

	const button = buttonColours(look.accent);
	const first = blocks.find((b) => 'text' in b && !/^Hello\b/.test(b.text));
	const preview = first && 'text' in first ? first.text : heading;
	const body = blocks
		.map((b) =>
			'text' in b
				? `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${LIGHT.ink}" class="ink">${escaped(b.text)}</p>`
				: linkBlock(b, button)
		)
		.join('\n');

	const masthead = look.logo
		? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:6px;border-radius:8px" class="chip"><img src="cid:${LOGO_CID}" alt="${escaped(look.name)}" height="${LOGO_HEIGHT}" width="${Math.round((look.logo.width / look.logo.height) * LOGO_HEIGHT)}" style="display:block;height:${LOGO_HEIGHT}px;width:auto;border:0;outline:none;text-decoration:none"></td></tr></table>`
		: `<span style="font-family:${FONT};font-size:18px;line-height:24px;font-weight:600;color:${LIGHT.ink}" class="ink">${escaped(look.name)}</span>`;

	const html = `<!doctype html>
<html lang="${escaped(lang)}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escaped(subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .ground { background-color: ${DARK.ground} !important; }
  .card { background-color: ${DARK.card} !important; border-color: ${DARK.line} !important; }
  .ink { color: ${DARK.ink} !important; }
  .muted { color: ${DARK.muted} !important; }
  .muted a, a.link { color: ${DARK.link} !important; }
  .chip { background-color: #ffffff !important; }
}
@media (max-width: 480px) {
  .card { padding: 24px 20px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${LIGHT.ground}" class="ground">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all" aria-hidden="true">${escaped(preview)}</div>
<div role="article" aria-roledescription="email" aria-label="${escaped(subject)}" lang="${escaped(lang)}" dir="${dir}" style="background-color:${LIGHT.ground}" class="ground">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${LIGHT.ground}" class="ground">
<tr><td align="center" style="padding:32px 16px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:0 4px 20px">${masthead}</td></tr>
<tr><td style="background-color:${LIGHT.card};border:1px solid ${LIGHT.line};border-radius:12px;padding:32px" class="card">
<h1 style="margin:0 0 20px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;color:${LIGHT.ink}" class="ink">${escaped(heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${LIGHT.muted}" class="muted">${escaped(footer)}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>
`;
	return { text, html };
}

/** A link as a button, its words saying where it goes, and the address in full under it. */
function linkBlock(
	/** @type {{ link: string, label: string }} */ b,
	/** @type {{ ground: string, words: string }} */ colours
) {
	const href = escaped(b.link);
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px">
<tr><td bgcolor="${colours.ground}" style="background-color:${colours.ground};border-radius:6px;padding:12px 20px">
<a href="${href}" style="font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${colours.words};text-decoration:none;display:inline-block">${escaped(b.label)}</a>
</td></tr>
</table>
<p style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${LIGHT.muted};word-break:break-all" class="muted">Or open this link: <a href="${href}" style="color:${LIGHT.link}" class="link">${href}</a></p>`;
}
