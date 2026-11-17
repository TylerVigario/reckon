import type { Expression, ExpressionBuilder, SqlBool } from 'kysely';
import type { DB } from './db/database.ts';

/**
 * WHAT IS SOMEONE'S OWN, for the routes Field reaches (#lib/access): the
 * screens show someone with Field only this, and the endpoints change only
 * what they made.
 */

/** Whether the person asking has Field, and so sees only their own. */
export const fieldOnly = (locals: App.Locals) => locals.user?.access !== 'full';

/**
 * Time entries someone worked: their own, and team entries that name them on
 * the crew. A condition on time_entry, for a query's where:
 * `.where((eb) => theirWork(eb, userId))`.
 */
export const theirWork = (
	eb: ExpressionBuilder<DB, 'time_entry'>,
	userId: string
): Expression<SqlBool> =>
	eb.or([
		eb('time_entry.worked_by', '=', userId),
		eb(
			'time_entry.id',
			'in',
			eb.selectFrom('time_entry_crew').select('time_entry_id').where('user_id', '=', userId)
		)
	]);
