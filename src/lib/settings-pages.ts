/**
 * Settings' screens, in the order its menu lists them: the menu itself on a
 * phone (#routes/settings), and the list down the side of each on a wide
 * screen (#routes/settings/+layout) -- one list, so the two cannot drift.
 */
export const SETTINGS_PAGES = [
	{ route: '/settings/business', title: 'Business' },
	{ route: '/settings/invoicing', title: 'Invoicing' },
	{ route: '/settings/tax', title: 'Tax' },
	{ route: '/settings/travel', title: 'Travel' },
	{ route: '/settings/units', title: 'Units' },
	{ route: '/settings/integrations', title: 'Integrations' }
] as const;
