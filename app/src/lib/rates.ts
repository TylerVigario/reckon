/**
 * What an hour of a service is worth to this client, for one person or a team.
 *
 * The figures are worked out by the database -- job_rate(), the one place a
 * price is resolved -- and handed to the page as strings for both crews, so
 * this only chooses between them: this client's price if it has one, else the
 * price for every client. Two screens ask the same question, starting a timer
 * and entering past work, and a change here is a change to both.
 *
 * Nothing is added up here. A team's rate is the first person's plus each
 * additional person's, and that sum is NUMERIC arithmetic done in Postgres --
 * parsing a rate into a Number on the way past is how a cent goes missing.
 */
export type Price = {
	service_id: string;
	entity_id: string | null;
	one: string | null;
	team: string | null;
};

export function rateFor(
	prices: Price[],
	serviceId: string | null,
	entityId: string | null,
	crew: 'one' | 'team'
): string | null {
	if (!serviceId) return null;
	const rows = prices.filter((p) => p.service_id === serviceId);
	const pick =
		rows.find((p) => p.entity_id !== null && p.entity_id === entityId) ??
		rows.find((p) => p.entity_id === null);
	if (!pick) return null;
	return crew === 'team' ? pick.team : pick.one;
}
