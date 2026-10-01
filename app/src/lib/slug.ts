/**
 * A name as it reads in a URL.
 *
 * The database says what a slug is, by a CHECK -- lowercase words joined by
 * single hyphens -- and this makes one: in the browser, to show the URL WHILE
 * somebody is typing the name, and on the server, when a site or a service
 * arrives without one.
 *
 * scripts/schema-check.mjs puts the same names through this and then through
 * the CHECK's own pattern, so a slug made here that the database would refuse
 * fails the build rather than a save.
 */
export function toSlug(source: string): string {
	return source
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
