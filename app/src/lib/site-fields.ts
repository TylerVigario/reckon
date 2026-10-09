/**
 * What a site may say about itself.
 *
 * Same contract as the other two registries: the page imports it to answer
 * without a round trip, the endpoint imports it because the page is not why a
 * value is safe, and the keys are the allowlist -- a request names a field and
 * the column written is this object's own key, which is source text.
 *
 * WHAT IS NOT HERE IS THE POINT. tax_rate_pct, state_rate_pct,
 * district_rate_pct, tax_jurisdiction, tax_area_code and area_verified_on are
 * absent, and no request can name them. They are CDTFA's answer about an
 * address; the only way they change is by asking again. Letting a form write
 * a rate is how a rate goes stale.
 */
import {
	cap,
	decimal,
	flag,
	no,
	ok,
	optional,
	parseIn,
	required,
	whole,
	type Parsed
} from './field-rules.ts';
import { toSlug } from './slug.ts';

export type { Parsed };

export const SITE_FIELDS = {
	// What this client calls it. Unique per client, which the database says.
	label: required('A name for the place is needed.', cap(120)),

	// What it is called in a URL, within this client. Normalised rather than
	// refused -- typing "Main Street office" and being told off helps nobody, and the
	// rule is not a secret. Changing it moves the page's address, which is the
	// caller's to handle.
	slug: (raw: string): Parsed => {
		const v = toSlug(raw.trim());
		if (!v) return no('Letters or digits are needed -- that leaves nothing for a URL.');
		return v.length > 80 ? no('At most 80 characters.') : ok(v);
	},

	// The address is chosen from Google's suggestions (8 October 2026), and these
	// are its parts as Google gave them, with the place they are -- never typed.
	// Street, city and postcode are all required, here as in the schema: the
	// CDTFA lookup takes all three or answers nothing, and a site with no rate
	// cannot be billed from.
	street: required('That place has no street: choose a street address.', cap(200)),
	city: required('That place has no city: choose a street address.', cap(120)),
	region: required('That place has no state: choose a street address.', cap(60)),
	postcode: required('That place has no postcode, and CDTFA needs one.', cap(20)),
	google_place_id: required("Choose the address from Google's suggestions.", cap(300)),

	// Round trip from the yard, and how long it takes. Both optional: a site
	// nobody has measured still bills for the work done at it.
	round_trip_miles: optional(decimal(8, 1)),
	drive_minutes: optional(whole(0)),

	active: flag
};

export type SiteFieldName = keyof typeof SITE_FIELDS;

/**
 * The fields that, when changed, mean CDTFA has to be asked again. They move
 * together, with the place they are (google_place_id), or not at all.
 */
export const ADDRESS_FIELDS = [
	'street',
	'city',
	'region',
	'postcode'
] as const satisfies readonly SiteFieldName[];

/** Parse one site field by name. An unknown name is refused. */
export function parseSiteField(name: string, raw: string): Parsed {
	return parseIn(SITE_FIELDS, name, raw);
}
