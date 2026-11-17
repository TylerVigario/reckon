import { toSlug } from '#lib/slug.ts';

/**
 * Inserts a row a URL names by its slug, making the slug from its name when
 * none was given: `harbor-light-dental`, then `-2`, `-3` for a name that reads
 * the same as one already there.
 *
 * The unique constraint decides, not a read beforehand, so two saves at once
 * cannot both take the same slug. `insert` is handed each slug to try, and
 * whether it was made here: a made one is inserted ON CONFLICT ON CONSTRAINT
 * <the slug's> DO NOTHING -- `.$if(made, (qb) => qb.onConflict((oc) =>
 * oc.constraint(...).doNothing()))` -- so one already taken inserts no row,
 * and the next is tried; the transaction carries on, as Postgres has it, with
 * no error to roll back. A slug that was given is inserted as it is, and its
 * clash is the caller's to refuse.
 */
export async function insertNamed<T>(
	slug: { given: string | null; from: string; fallback: string },
	insert: (slug: string, made: boolean) => Promise<T | undefined>
): Promise<T> {
	if (slug.given) {
		const row = await insert(slug.given, false);
		if (row === undefined) throw new Error('The insert returned no row.');
		return row;
	}
	const base = toSlug(slug.from) || slug.fallback;
	for (let n = 1; ; n++) {
		const row = await insert(n === 1 ? base : `${base}-${n}`, true);
		if (row !== undefined) return row;
	}
}
