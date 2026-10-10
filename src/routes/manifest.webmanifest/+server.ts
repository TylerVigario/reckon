import { db } from '#lib/server/db/index.ts';
import { operator } from '#lib/server/db/schema/index.ts';
import { iconFromLogo } from '#lib/server/app-icon.ts';
import type { RequestHandler } from './$types';

/**
 * The web app manifest: what a phone installs, named for the business.
 *
 * Its name is the operator's, its colour theirs, and its icon their logo where
 * the logo is fit to be one (#lib/server/app-icon.ts) -- reckon's own tally
 * where it is not. The default icons are rendered from static/icons/reckon.svg:
 * 192 and 512 on a rounded ground for "any", and 512 full-bleed for "maskable",
 * which a launcher crops to its own shape.
 *
 * Open to a signed-out request (hooks.server.ts): a browser fetches the
 * manifest, and the icons it names, without the session cookie.
 */
const DEFAULT_ICONS = [
	{ src: '/icons/reckon-192.png', type: 'image/png', sizes: '192x192', purpose: 'any' },
	{ src: '/icons/reckon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any' },
	{
		src: '/icons/reckon-maskable-512.png',
		type: 'image/png',
		sizes: '512x512',
		purpose: 'maskable'
	}
];

export const GET: RequestHandler = async () => {
	const [row] = await db
		.select({
			tradingName: operator.tradingName,
			shortName: operator.shortName,
			accent: operator.accentColour,
			logo: operator.logo,
			logoMediaType: operator.logoMediaType
		})
		.from(operator)
		.limit(1);

	const name = row?.tradingName ?? 'reckon';
	const accent = row?.accent?.toLowerCase();
	const fit = row?.logo ? iconFromLogo(new Uint8Array(row.logo), row.logoMediaType) : null;

	const manifest = {
		id: '/',
		name,
		short_name: row?.shortName ?? name,
		description: 'Time, trips and invoices',
		start_url: '/',
		scope: '/',
		display: 'standalone',
		background_color: '#eef1f5',
		theme_color: accent && /^#[0-9a-f]{6}$/.test(accent) ? accent : '#1d6f9c',
		icons: fit
			? [{ src: '/operator/logo', type: fit.type, sizes: fit.sizes, purpose: 'any' }]
			: DEFAULT_ICONS
	};
	return new Response(JSON.stringify(manifest), {
		headers: {
			'content-type': 'application/manifest+json',
			// Checked again on every launch, so a new name, colour or logo shows.
			'cache-control': 'no-cache'
		}
	});
};
