import { eq, inArray, or } from 'drizzle-orm';
import { db } from './db/index.ts';
import * as t from './db/schema/index.ts';

/**
 * WHAT IS SOMEONE'S OWN, for the routes Field reaches (#lib/access): the
 * screens show someone with Field only this, and the endpoints change only
 * what they made.
 */

/** Whether the person asking has Field, and so sees only their own. */
export const fieldOnly = (locals: App.Locals) => locals.user?.access !== 'full';

/** Time entries someone worked: their own, and team entries that name them on the crew. */
export const theirWork = (userId: string) =>
	or(
		eq(t.timeEntry.workedBy, userId),
		inArray(
			t.timeEntry.id,
			db
				.select({ id: t.timeEntryCrew.timeEntryId })
				.from(t.timeEntryCrew)
				.where(eq(t.timeEntryCrew.userId, userId))
		)
	);
