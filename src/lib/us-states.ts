/**
 * THE STATES, as the post writes them (USPS Publication 28, appendix B) and as
 * Google names a place's: the fifty and the District of Columbia. A site is in
 * one (site.region), a business collects tax in some (tax_registration), and a
 * tax area is in one (tax_area.state).
 */
export const STATES = {
	AL: 'Alabama',
	AK: 'Alaska',
	AZ: 'Arizona',
	AR: 'Arkansas',
	CA: 'California',
	CO: 'Colorado',
	CT: 'Connecticut',
	DE: 'Delaware',
	DC: 'District of Columbia',
	FL: 'Florida',
	GA: 'Georgia',
	HI: 'Hawaii',
	ID: 'Idaho',
	IL: 'Illinois',
	IN: 'Indiana',
	IA: 'Iowa',
	KS: 'Kansas',
	KY: 'Kentucky',
	LA: 'Louisiana',
	ME: 'Maine',
	MD: 'Maryland',
	MA: 'Massachusetts',
	MI: 'Michigan',
	MN: 'Minnesota',
	MS: 'Mississippi',
	MO: 'Missouri',
	MT: 'Montana',
	NE: 'Nebraska',
	NV: 'Nevada',
	NH: 'New Hampshire',
	NJ: 'New Jersey',
	NM: 'New Mexico',
	NY: 'New York',
	NC: 'North Carolina',
	ND: 'North Dakota',
	OH: 'Ohio',
	OK: 'Oklahoma',
	OR: 'Oregon',
	PA: 'Pennsylvania',
	RI: 'Rhode Island',
	SC: 'South Carolina',
	SD: 'South Dakota',
	TN: 'Tennessee',
	TX: 'Texas',
	UT: 'Utah',
	VT: 'Vermont',
	VA: 'Virginia',
	WA: 'Washington',
	WV: 'West Virginia',
	WI: 'Wisconsin',
	WY: 'Wyoming'
} as const;

export type State = keyof typeof STATES;

export const isState = (s: string | null | undefined): s is State =>
	typeof s === 'string' && Object.hasOwn(STATES, s);

/** A state's name, or what was given where it is none. */
export const stateName = (s: string) => (isState(s) ? STATES[s] : s);

/**
 * Where there is no sales tax to collect, state or local: Delaware, New
 * Hampshire and Oregon. Alaska and Montana have none statewide but local ones
 * -- Alaska's cities and boroughs, Montana's resort areas -- so they are not
 * among them.
 */
export const NO_SALES_TAX: readonly State[] = ['DE', 'NH', 'OR'];

/**
 * How a site's tax area is found in a state, where reckon can find one: by
 * asking the state's authority about its address. California's is CDTFA, the
 * California Department of Tax and Fee Administration (#lib/server/cdtfa).
 * A business can collect tax only where a site's area can be found.
 */
export const AUTHORITY: Partial<Record<State, { short: string; name: string }>> = {
	CA: { short: 'CDTFA', name: 'California Department of Tax and Fee Administration' }
};

/** The states a business can collect tax in: each one whose areas reckon can find. */
export const COLLECTABLE = (Object.keys(STATES) as State[]).filter((s) => AUTHORITY[s]);
