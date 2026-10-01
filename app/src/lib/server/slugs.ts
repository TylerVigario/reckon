import { toSlug } from '$lib/slug';
import type { Tx } from './db';
import { pgError } from './field-errors';

/**
 * Inserts a row a URL names by its slug, making the slug from its name when
 * none was given: `harbor-light-dental`, then `-2`, `-3` for a name that reads
 * the same as one already there.
 *
 * The unique constraint decides, not a read beforehand, so two saves at once
 * cannot both take the same slug. Each attempt is a savepoint, so a clash costs
 * a retry rather than the transaction.
 */
export async function insertNamed<T>(
	tx: Tx,
	slug: { given: string | null; from: string; fallback: string; constraint: string },
	insert: (tx: Tx, slug: string) => Promise<T>
): Promise<T> {
	if (slug.given) return insert(tx, slug.given);
	const base = toSlug(slug.from) || slug.fallback;
	for (let n = 1; ; n++) {
		const candidate = n === 1 ? base : `${base}-${n}`;
		try {
			return await tx.transaction((sp) => insert(sp, candidate));
		} catch (e) {
			if (pgError(e).constraint !== slug.constraint) throw e;
		}
	}
}
