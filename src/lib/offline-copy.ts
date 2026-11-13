/**
 * A SCREEN KEPT FOR NO SIGNAL IS A COPY OF ITS OWN, cut to what can be done
 * with it there (src/service-worker). The worker fetches each screen it keeps
 * with this query, and its loader leaves out what no task on site needs: what
 * the business is owed, holds or has not billed, what work is worth, anyone's
 * pay, and other people's work. A form is kept whole, since what it asks with
 * -- its choices, its rates, a draft's lines -- is the task. Each part left
 * out says it needs a connection.
 *
 * The screen as it is with a signal is never kept (ASVS 5.0 14.2.6: "only
 * returns the minimum required sensitive data").
 */
export const OFFLINE_COPY = 'copy=offline';

/** Whether a screen is being asked for as the copy kept for no signal. */
export const isOfflineCopy = (url: URL) => url.searchParams.get('copy') === 'offline';

/**
 * HOW LONG SOMEONE STAYS SIGNED IN, as GitHub keeps them: until two weeks
 * without use ("GitHub typically marks a user session for deletion after two
 * weeks of inactivity"), each use carrying it on (#lib/server/auth).
 *
 * And so how long a phone keeps its copies without hearing from the server: a
 * session unused this long has ended there, so a phone that has not reached
 * the server in that time forgets what it kept, by itself (ASVS 5.0 14.3.1:
 * "the client-side should also be able to clear up if the server connection
 * is not available when the session is terminated"). Unsent work is not a
 * copy, and stays.
 */
export const SESSION_UNUSED_DAYS = 14;
