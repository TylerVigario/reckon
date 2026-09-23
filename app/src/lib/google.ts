/// <reference types="google.maps" />
// Stated outright rather than left to @types auto-inclusion, which does not
// reach this project's tsconfig: the SDK is loaded at runtime by the script
// tag below, so this reference is the only thing that says what it will be.
import { env } from '$env/dynamic/public';

/**
 * Loading the Maps JavaScript API, once.
 *
 * The SDK rather than the REST endpoints, because it is the only browser-side
 * path whose key can be restricted. Google's guidance splits them: an HTTP
 * referrer restriction works for the JavaScript API "because browsers send
 * Referer headers", while a web-service call wants an IP restriction -- which
 * is meaningless when the caller is somebody else's browser. A key fetching
 * places.googleapis.com from a page can be locked to nothing at all.
 *
 * Direct from the browser either way, which is the point: a type-ahead fires on
 * every keystroke, and a proxy would put a round trip to our own server in
 * front of each one.
 */

export const KEY = env.PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
export const addressesAreLive = KEY !== '';

let loading: Promise<void> | null = null;

/** Idempotent: several fields on a page share one load. */
function boot(): Promise<void> {
	if (typeof window === 'undefined') return Promise.reject(new Error('browser only'));
	// `typeof` rather than a member test: the SDK is appended below, so before
	// that runs the identifier does not exist and reading it would throw.
	if (typeof google !== 'undefined' && typeof google.maps?.importLibrary === 'function')
		return Promise.resolve();

	return (loading ??= new Promise<void>((res, rej) => {
		const script = document.createElement('script');
		script.async = true;
		// v=weekly rather than a pinned version: Google retires versions on a
		// schedule, and a pin becomes a breakage on a date nobody wrote down.
		// No libraries= parameter: importLibrary('places') fetches it when it is
		// first needed, and naming it here only forces an eager load of something
		// the page may never use.
		script.src =
			`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}` +
			`&loading=async&v=weekly`;
		script.onload = () => res();
		script.onerror = () => {
			loading = null;
			rej(new Error('could not load the Google Maps SDK'));
		};
		document.head.appendChild(script);
	}));
}

export type Resolved = {
	placeId: string;
	formatted: string;
	street: string | null;
	city: string | null;
	region: string | null;
	postcode: string | null;
	country: string | null;
	lat: number | null;
	lng: number | null;
};

export type Suggestion = {
	placeId: string;
	text: string;
	prediction: google.maps.places.PlacePrediction;
};

/** A session covers every keystroke and the details call that ends it. */
export async function newSession() {
	await boot();
	const { AutocompleteSessionToken } = await google.maps.importLibrary('places');
	return new AutocompleteSessionToken();
}

export async function suggest(
	input: string,
	sessionToken: google.maps.places.AutocompleteSessionToken | undefined
): Promise<Suggestion[]> {
	await boot();
	const { AutocompleteSuggestion } = await google.maps.importLibrary('places');
	const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
		input,
		sessionToken,
		// Where a place is, not what it is called.
		includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'],
		includedRegionCodes: ['us']
	});
	return (suggestions ?? [])
		.map((s) => s.placePrediction)
		.filter((p) => p !== null)
		.map((p) => ({ placeId: p.placeId, text: p.text?.toString() ?? '', prediction: p }));
}

const part = (c: google.maps.places.AddressComponent[], type: string, short = false) => {
	const hit = c.find((x) => x.types.includes(type));
	return (short ? hit?.shortText : hit?.longText) ?? null;
};

/**
 * The chosen place, split into what the schema stores.
 *
 * fetchFields ends the session, which is why the caller takes a new token
 * afterwards rather than reusing this one.
 */
export async function resolve(s: Suggestion): Promise<Resolved> {
	const place = s.prediction.toPlace();
	await place.fetchFields({
		fields: ['id', 'formattedAddress', 'addressComponents', 'location']
	});
	const c = place.addressComponents ?? [];
	const number = part(c, 'street_number');
	const route = part(c, 'route');
	return {
		placeId: place.id ?? s.placeId,
		formatted: place.formattedAddress ?? s.text,
		street: [number, route].filter(Boolean).join(' ') || null,
		// A rural address often has no locality, only a postal town.
		city: part(c, 'locality') ?? part(c, 'postal_town') ?? part(c, 'sublocality'),
		region: part(c, 'administrative_area_level_1', true),
		postcode: part(c, 'postal_code'),
		country: part(c, 'country', true),
		lat: place.location?.lat?.() ?? null,
		lng: place.location?.lng?.() ?? null
	};
}
