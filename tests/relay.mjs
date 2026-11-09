/**
 * What the checks read back from the relay stand-in (tests/smtp-stand-in.mjs),
 * and how they use a link reckon emailed (#lib/server/links), as a browser's
 * page does: the code read from the email, posted to the page's actions.
 */

/** @typedef {{ from: string, to: string[], data: string, at: string, text: string }} Taken */

/** A message body as written, from the quoted-printable nodemailer sends long lines as. */
export const decoded = (/** @type {string} */ data) => {
	const joined = data.replace(/=\r\n/g, '');
	const bytes = [];
	for (let i = 0; i < joined.length; i++) {
		const hex = /^=([0-9A-F]{2})/.exec(joined.slice(i, i + 3));
		if (hex) {
			bytes.push(parseInt(hex[1], 16));
			i += 2;
		} else bytes.push(...Buffer.from(joined[i]));
	}
	return Buffer.from(bytes).toString('utf8');
};

/** What the relay at `relay` has taken, its bodies decoded. */
export async function inbox(/** @type {string} */ relay) {
	const taken = /** @type {Omit<Taken, 'text'>[]} */ (
		await (await fetch(`${relay}/messages`)).json()
	);
	return taken.map((m) => /** @type {Taken} */ ({ ...m, text: decoded(m.data) }));
}

/**
 * The newest message to `to` whose text has every one of `says`, waited for a
 * while, or null.
 */
export async function arrives(
	/** @type {string} */ relay,
	/** @type {string} */ to,
	/** @type {string[]} */ says,
	seconds = 15
) {
	for (let i = 0; i < seconds * 4; i++) {
		const found = (await inbox(relay))
			.filter((m) => m.to.includes(to) && says.every((s) => m.text.includes(s)))
			.at(-1);
		if (found) return found;
		await new Promise((r) => setTimeout(r, 250));
	}
	return null;
}

/** The link in a message, and the code after its #. */
export function linkIn(/** @type {Taken | null} */ m) {
	const found = m ? /(\S+)\/link#([A-Za-z0-9_-]{43})(?=\s)/.exec(m.text) : null;
	return found ? { site: found[1], code: found[2] } : null;
}

/**
 * One of /link's actions, posted as the page posts it. Its type -- success,
 * failure -- its status, and the rest as text, to look in.
 */
export async function linkAction(
	/** @type {string} */ base,
	/** @type {'look' | 'choose' | 'confirm'} */ name,
	/** @type {Record<string, string>} */ fields,
	/** @type {Record<string, string>} */ headers = {}
) {
	const r = await fetch(`${base}/link?/${name}`, {
		method: 'POST',
		body: new URLSearchParams(fields),
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'x-sveltekit-action': 'true',
			origin: base,
			...headers
		}
	});
	const text = await r.text();
	const { type, status } = /** @type {{ type: string, status: number }} */ (JSON.parse(text));
	return {
		type,
		status,
		text,
		setsSession: r.headers.getSetCookie().some((c) => c.includes('session_token='))
	};
}
