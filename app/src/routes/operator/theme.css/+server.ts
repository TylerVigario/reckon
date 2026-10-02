import { db } from '#lib/server/db/index.ts';
import { operator } from '#lib/server/db/schema/index.ts';
import type { RequestHandler } from './$types';

/**
 * The operator's colour, as a stylesheet.
 *
 * It was a style attribute on the shell, which the content security policy
 * refuses -- style-src 'self' admits stylesheets from this origin and no inline
 * style -- so the colour never reached a built page. A stylesheet of this
 * origin's is admitted, and unlike setting it from script it is there for the
 * first paint.
 *
 * The colour is checked again here, not only when it is saved: this writes it
 * into CSS, and a value that is not #rrggbb is not written at all.
 *
 * The layout keys the URL by the colour, so the response can be kept for good:
 * a new colour is a new URL.
 */
export const GET: RequestHandler = async () => {
	const [row] = await db.select({ accent: operator.accentColour }).from(operator).limit(1);
	const accent = row?.accent?.toLowerCase();
	const css = accent && /^#[0-9a-f]{6}$/.test(accent) ? `.app { --accent: ${accent}; }\n` : '';
	return new Response(css, {
		headers: {
			'content-type': 'text/css; charset=utf-8',
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
