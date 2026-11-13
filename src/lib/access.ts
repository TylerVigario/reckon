import type { RouteId } from '$app/types';

/**
 * WHAT EACH PERSON CAN REACH (0031), apart from what they are paid as.
 *
 * Full is everything, and the only level that bills or pays. Field is the work
 * someone does and what they are paid for it: their own time and trips, team
 * work they were on, lines added to a draft, the clients and sites they work
 * at, and their own pay, to read. A level is set on each person, by someone
 * with Full; someone new starts with Field, and the database keeps one active
 * person on Full.
 */
export const ACCESS = ['full', 'field'] as const;
export type Access = (typeof ACCESS)[number];

/** Each level as a person is told it: in brief, and in full where it is chosen. */
export const ACCESS_WORDS: Record<Access, { label: string; reach: string; detail: string }> = {
	full: {
		label: 'Full',
		reach: 'Everything, and the only level that bills or pays',
		detail:
			'Anyone’s time and trips; clients and sites, and changing them; invoices, from drafts to payments; agreements, prices and the catalogue; everyone’s pay, and paying people; reports, the team, settings and tax.'
	},
	field: {
		label: 'Field',
		reach: 'Their own work, and what they are paid for it',
		detail:
			'Their own time and trips, and team work they were on; clients and sites, to work at; lines added to a draft, and changing the ones they added; their own pay, to read.'
	}
};

/** Who a route is for: anyone, signed in or not, or someone with this level or more. */
export type Reach = 'open' | Access;

/**
 * EVERY ROUTE, AND WHO REACHES IT. hooks.server.ts refuses whatever someone's
 * level does not reach, before the route runs: an endpoint with a 403 problem
 * document, and a screen by turning it away to /refused. Typed against the
 * app's own route list, so a route added without a line here does not
 * typecheck, and nothing is reachable by leaving it out.
 *
 * A route Field reaches is also scoped where it runs: their own entries and
 * trips, the lines they added, drafts and nothing sent, no prices, nobody
 * else's pay. This says only who may ask.
 *
 * Shared with the screens, so a link is offered only where it opens.
 */
export const REACH = {
	// What the sign-in page needs, the client's link to a sent invoice -- one
	// page, opened by a token nobody can guess, showing that invoice alone --
	// and where a link reckon emailed opens, by a code nobody can guess.
	'/login': 'open',
	'/link': 'open',
	'/manifest.webmanifest': 'open',
	'/operator/logo': 'open',
	'/operator/theme.css': 'open',
	'/invoice/[token]': 'open',

	// The shell, and what anyone signed in does to their own session and device.
	'/': 'field',
	'/refused': 'field',
	'/more': 'field',
	'/profile': 'field',
	'/profile/passkeys': 'field',
	'/profile/security-log': 'field',
	'/logout': 'field',
	'/api/device': 'field',
	'/api/reachable': 'field',
	'/api/offline': 'field',
	// Their own zone and how figures read; who is paid as what, and access, are Full's.
	'/api/people/[id]': 'field',

	// Their own time, and team work they were on.
	'/timesheet': 'field',
	'/timesheet/[id]': 'field',
	'/timesheet/all': 'field',
	'/timesheet/manual': 'field',
	'/timesheet/start': 'field',
	'/api/time': 'field',
	'/api/time/[id]': 'field',

	// Trips they drove.
	'/trips': 'field',
	'/trips/[id]': 'field',
	'/trips/[id]/change': 'field',
	'/trips/new': 'field',
	'/api/trips': 'field',
	'/api/trips/[id]': 'field',
	'/api/trips/route': 'field',
	'/api/trips/worth': 'field',

	// Drafts, and the lines they add to one.
	'/invoices': 'field',
	'/invoices/[id]': 'field',
	'/invoices/[id]/add': 'field',
	'/invoices/[id]/lines/[line]': 'field',
	'/invoices/[id]/lines/[line]/change': 'field',
	'/invoices/[id]/lines/[line]/receipt': 'field',
	'/api/lines': 'field',
	'/api/lines/[id]': 'field',
	'/api/lines/[id]/restore': 'field',

	// The clients and sites they work at, to read.
	'/clients': 'field',
	'/clients/contacts': 'field',
	'/clients/contacts/[id]': 'field',
	'/clients/[id]': 'field',
	'/clients/[id]/contacts': 'field',
	'/clients/[id]/sites': 'field',
	'/clients/[id]/sites/[site]': 'field',

	// Their own pay, to read.
	'/reports/pay/[person]': 'field',
	'/reports/pay/[person]/paid': 'field',
	'/reports/pay/payments/[id]': 'field',

	// Everything else: billing, pay, prices, the catalogue, people and settings.
	'/invoices/new': 'full',
	'/invoices/on-phone': 'full',
	'/invoices/on-phone/add': 'full',
	'/invoices/ready': 'full',
	'/invoices/[id]/send': 'full',
	'/invoices/[id]/lines/[line]/history': 'full',
	'/api/drafts': 'full',
	'/api/invoices/[id]/send': 'full',
	'/unbilled': 'full',
	'/clients/[id]/sites/new': 'full',
	'/api/clients/[id]': 'full',
	'/api/clients/[id]/sites': 'full',
	'/api/clients/[id]/sites/[site]': 'full',
	'/api/clients/[id]/sites/[site]/contacts': 'full',
	'/api/clients/[id]/sites/[site]/ask-cdtfa': 'full',
	'/clients/[id]/contacts/new': 'full',
	'/api/clients/[id]/contacts': 'full',
	'/api/contacts/[id]': 'full',
	'/api/sites/drive': 'full',
	'/api/address': 'full',
	'/catalogue': 'full',
	'/catalogue/agreements': 'full',
	'/catalogue/agreements/[id]': 'full',
	'/catalogue/agreements/new': 'full',
	'/catalogue/materials': 'full',
	'/catalogue/materials/[id]': 'full',
	'/catalogue/materials/[id]/lots/[lot]/receipt': 'full',
	'/catalogue/materials/receive': 'full',
	'/api/agreements': 'full',
	'/api/agreements/[id]': 'full',
	'/api/agreements/[id]/coverage/[service]': 'full',
	'/catalogue/services': 'full',
	'/catalogue/services/[id]': 'full',
	'/catalogue/services/[id]/history': 'full',
	'/catalogue/services/new': 'full',
	'/api/services': 'full',
	'/api/services/[id]': 'full',
	'/api/services/[id]/prices': 'full',
	'/api/services/[id]/prices/[price]': 'full',
	'/api/services/[id]/rules': 'full',
	'/api/services/[id]/rules/[rule]': 'full',
	'/reports': 'full',
	'/reports/pay': 'full',
	'/reports/retainers': 'full',
	'/reports/non-billable': 'full',
	'/reports/schedule-a': 'full',
	'/api/pay': 'full',
	'/team': 'full',
	'/team/new': 'full',
	'/team/[id]': 'full',
	'/team/[id]/passkeys': 'full',
	'/team/[id]/security-log': 'full',
	'/team/roles': 'full',
	'/team/security-log': 'full',
	'/settings': 'full',
	'/settings/business': 'full',
	'/settings/integrations': 'full',
	'/settings/invoicing': 'full',
	'/settings/tax': 'full',
	'/settings/travel': 'full',
	'/settings/travel/vehicles/[id]': 'full',
	'/settings/travel/vehicles/new': 'full',
	'/settings/units': 'full',
	'/api/settings': 'full',
	'/api/people': 'full',
	'/api/people/[id]/link': 'full',
	'/api/people/[id]/passkeys': 'full',
	'/api/people/[id]/passkeys/[passkey]': 'full',
	'/api/people/[id]/invitation': 'full',
	'/api/people/[id]/email-change': 'full',
	'/api/roles': 'full',
	'/api/roles/[id]': 'full',
	'/api/units': 'full',
	'/api/units/[id]': 'full',
	'/api/vehicles': 'full',
	'/api/vehicles/[id]': 'full'
} as const satisfies Record<RouteId, Reach>;

/** Whether someone with `access` reaches what a route needs. */
export const reaches = (access: Access, need: Reach) =>
	need === 'open' || need === 'field' || access === 'full';

/** Whether someone with `access` reaches a route: what the screens ask before offering a link. */
export const opens = (access: Access | null | undefined, route: RouteId) =>
	access ? reaches(access, REACH[route]) : REACH[route] === 'open';
