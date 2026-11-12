// A refusal for lack of access, in the security log (ASVS 5.0 16.3.2): who,
// and what they asked for, by the route's template. Where reckon answers 404
// rather than say a thing is there -- Field asking for a sent invoice, or
// someone else's pay -- it is recorded all the same, since to them it is not
// found but to the log it was refused.
import type { RequestEvent } from '@sveltejs/kit';
import { recordAside } from './events.ts';

export const refusedForAccess = (
	event: Pick<RequestEvent, 'locals' | 'route' | 'request'>
): Promise<void> =>
	event.locals.user
		? recordAside('authz_fail', {
				user: event.locals.user.id,
				by: null,
				detail: { route: event.route.id ?? null, method: event.request.method }
			})
		: Promise.resolve();
