import type { RequestHandler } from './$types';

/**
 * Answers, and does nothing else: how a screen opened from the copy the
 * service worker kept tells whether the server is in reach (#lib/OfflineBanner).
 * The worker never answers for /api, so no answer means no server.
 */
export const GET: RequestHandler = () =>
	new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
