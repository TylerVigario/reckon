/**
 * Settings' screens, in groups, in the order its menu lists them: the menu
 * itself on a phone (#routes/settings), and the list down the side of each on
 * a wide screen (#routes/settings/+layout) -- one list, so the two cannot
 * drift. Grouped under headings, as Primer's NavList groups a long settings
 * menu: the business itself, how it bills, the work, and what it connects to.
 */
export const SETTINGS_GROUPS = [
	{
		title: 'The business',
		pages: [
			{ route: '/settings/business', title: 'Business' },
			{ route: '/settings/brand', title: 'Brand' },
			{ route: '/settings/region', title: 'Region' }
		]
	},
	{
		title: 'Billing',
		pages: [
			{ route: '/settings/invoicing', title: 'Invoicing' },
			{ route: '/settings/pricing', title: 'Pricing' },
			{ route: '/settings/tax', title: 'Tax' }
		]
	},
	{
		title: 'The work',
		pages: [
			{ route: '/settings/travel', title: 'Travel' },
			{ route: '/settings/vehicles', title: 'Vehicles' },
			{ route: '/settings/units', title: 'Units' }
		]
	},
	{
		title: 'Connections',
		pages: [{ route: '/settings/integrations', title: 'Integrations' }]
	}
] as const;

export type SettingsPage = (typeof SETTINGS_GROUPS)[number]['pages'][number];
