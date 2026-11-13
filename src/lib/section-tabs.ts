import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { Access } from '#lib/access.ts';

/**
 * THE TABS OF EACH SECTION THAT HAS THEM, in one place, so every screen of a
 * section draws the same row (#lib/UnderlineNav).
 *
 * A section has tabs where it is one thing in parts used one at a time and
 * never compared: about five at most, each a word or two that fits a phone's
 * width beside the others, the most used first, and each its own address.
 * The first is where the section opens. Lists of one thing in two scopes are
 * not tabs (#lib/Segmented), nor is a settings menu, nor a sequence of steps.
 */
export type Tab = { href: ResolvedPathname; label: string; count?: number; current: boolean };

/**
 * What can go on a line. Materials first: stock is received far more often
 * than a price or an agreement changes. Receipts beside them: what was bought
 * on each, and where it is received. No counts: with two-digit counts the
 * row fills a phone.
 */
export const catalogueTabs = (
	here: 'materials' | 'receipts' | 'services' | 'agreements'
): Tab[] => [
	{ href: resolve('/catalogue/materials'), label: 'Materials', current: here === 'materials' },
	{ href: resolve('/catalogue/receipts'), label: 'Receipts', current: here === 'receipts' },
	{ href: resolve('/catalogue/services'), label: 'Services', current: here === 'services' },
	{ href: resolve('/catalogue/agreements'), label: 'Agreements', current: here === 'agreements' }
];

/** Who the work is for, and the people at them. */
export const entityTabs = (
	here: 'clients' | 'contacts',
	counts: { clients: number; contacts: number }
): Tab[] => [
	{
		href: resolve('/clients'),
		label: 'Clients',
		count: counts.clients,
		current: here === 'clients'
	},
	{
		href: resolve('/clients/contacts'),
		label: 'Contacts',
		count: counts.contacts,
		current: here === 'contacts'
	}
];

/**
 * Where a client opens for someone: on Details for Full, and on Sites for
 * Field, who sees nothing of what is on Details (#lib/access). A link to a
 * client goes there directly, rather than through Details turning them away.
 */
export const clientOpens = (slug: string, access: Access | null | undefined) =>
	access === 'full'
		? resolve('/clients/[id]', { id: slug })
		: resolve('/clients/[id]/sites', { id: slug });

/**
 * The reports, by how often each is wanted: pay every pay period, the
 * retainers and the time given away every month, Schedule A once a year. No
 * counts: four labels and a count fill a phone.
 */
export const reportTabs = (here: 'pay' | 'retainers' | 'non-billable' | 'schedule-a'): Tab[] => [
	{ href: resolve('/reports/pay'), label: 'Pay', current: here === 'pay' },
	{ href: resolve('/reports/retainers'), label: 'Retainers', current: here === 'retainers' },
	{
		href: resolve('/reports/non-billable'),
		label: 'Non-billable',
		current: here === 'non-billable'
	},
	{ href: resolve('/reports/schedule-a'), label: 'Schedule A', current: here === 'schedule-a' }
];

/** The people who sign in, the roles they are paid as, and everyone's security log. */
export const teamTabs = (
	here: 'people' | 'roles' | 'security-log',
	counts: { people: number; roles: number }
): Tab[] => [
	{ href: resolve('/team'), label: 'People', count: counts.people, current: here === 'people' },
	{ href: resolve('/team/roles'), label: 'Roles', count: counts.roles, current: here === 'roles' },
	{
		href: resolve('/team/security-log'),
		label: 'Security log',
		current: here === 'security-log'
	}
];
