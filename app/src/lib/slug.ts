/**
 * A name as it reads in a URL.
 *
 * The same rule as slugify() in the database, on purpose and in both places:
 * the page needs it to show what the URL will be WHILE somebody is typing the
 * name, and the database needs it because the seed, the importer and any
 * script can insert a row without going near a form. Neither can be the only
 * one that knows.
 *
 * If these two ever disagree, the CHECK constraint catches it -- slug must
 * equal slugify(slug) -- so the drift shows up as a refusal rather than as a
 * URL that quietly cannot be resolved.
 */
export function toSlug(source: string): string {
	return source
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
