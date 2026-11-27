import { problem } from './problem.ts';
import { log } from './log.ts';

/**
 * Turning a database complaint into one a person can act on, keyed to the box
 * that caused it.
 *
 * Shared by every endpoint that saves fields, so a second one does not invent a
 * second error shape for the page to learn.
 */

/** A per-field complaint, which is the only shape the page knows how to show. */
export type Errors = Record<string, string>;

/**
 * A refusal keyed to the boxes that caused it.
 *
 * The map the pages read, carried as an extension member of a problem
 * document rather than as the whole body, so a
 * caller that knows nothing about this app still gets a type, a title and a
 * status it can act on.
 */
export const refuse = (errors: Errors) => problem('invalidField', only(errors), { errors });

/**
 * A refusal of what the boxes say as things stand, keyed to them all the same:
 * the values are right, but what is there now refuses them.
 */
export const refuseAsThingsStand = (errors: Errors) =>
	problem('notAsThingsStand', only(errors), { errors });

/** The one message, when there is only one -- so `detail` is not empty. */
const only = (errors: Errors) => {
	const all = Object.values(errors);
	return all.length === 1 ? all[0] : `${all.length} values were refused.`;
};

/** What Postgres said: pg's own error, which Kysely passes on as it is. */
type PgError = {
	code?: string;
	constraint?: string;
	table?: string;
	column?: string;
	message?: string;
};
export const pgError = (e: unknown): PgError => e ?? {};

/**
 * Which field a database error is about.
 *
 * Constraints are named after their column -- operator_ageing_alert_days_check,
 * service_minimum_charge_check -- so the field is recoverable from the name
 * and the complaint lands under the right box. A NOT NULL violation names the
 * column outright. A constraint spanning two columns, like
 * pay_rule_amount_fits_method, names neither, and falls through to the
 * request's only field, or to nothing when there were several -- because a
 * complaint shown against the wrong box is worse than one shown against all.
 */
export function blame(e: unknown, names: string[], prefix: string): string | null {
	const err = pgError(e);
	if (err.column && names.includes(err.column)) return err.column;

	const c = err.constraint ?? '';
	const stripped = c.replace(new RegExp(`^${prefix}_`), '').replace(/_(check|fkey|key)$/, '');
	if (names.includes(stripped)) return stripped;

	return names.length === 1 ? names[0] : null;
}

/**
 * Class 23 is integrity -- a CHECK or a foreign key. Class 22 is the data
 * itself: a NUMERIC too large for its precision, a string too long for its
 * column. Both are the caller's to fix, so both are 400s rather than 500s --
 * and the queue elsewhere in this app retries 5xx forever, which makes that
 * distinction load-bearing.
 *
 * Returns null for anything else, which the caller should rethrow.
 */
export function refuseIfTheDatabaseSaidSo(e: unknown, names: string[], prefix: string) {
	const err = pgError(e);
	const code = err.code ?? '';
	if (!code.startsWith('23') && !code.startsWith('22')) return null;

	// Getting here means a field rule no longer matches its column, so the
	// detail goes to the log, to be fixed there -- not in a field label,
	// where "violates check constraint service_minimum_charge_check" is
	// nothing anybody can act on.
	// The code and the rule, never Postgres's own message: that can quote the
	// value typed, which is the person's, not the log's (ASVS 5.0 16.2.5).
	log.error(
		{
			'db.response.status_code': code,
			'db.collection.name': err.table,
			constraint: err.constraint,
			column: err.column
		},
		'the database refused a value'
	);
	// 23505 is a unique violation, and "already taken" is the one database
	// complaint a person can act on directly -- so it says that rather than
	// the generic refusal.
	const why =
		code === '23505'
			? 'Something else already has that. Pick another.'
			: 'The database refused that value.';
	const field = blame(e, names, prefix);
	return refuse(field ? { [field]: why } : Object.fromEntries(names.map((n) => [n, why])));
}

/**
 * A delete the schema refused because something still points at the row.
 *
 * Two codes, and both mean it: 23503 when the foreign key is NO ACTION, 23001
 * when it is ON DELETE RESTRICT -- which is how the keys onto a service, an
 * agreement's periods and a role are declared. Both have to be checked, or a
 * restricted delete comes back as a 500 instead of a sentence.
 */
export function stillReferenced(e: unknown): boolean {
	const code = pgError(e).code;
	return code === '23503' || code === '23001';
}
