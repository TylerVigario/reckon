/**
 * What an hour of a service is worth to this client, with this crew.
 *
 * Most specific wins, and the order is the database's own: a price set for
 * this client and this crew, then for this client, then for this crew, then
 * the house price. Two screens ask the same question -- starting a timer and
 * entering past work -- and when it lived in both of them a change to one was
 * a rate the other did not know about.
 *
 * The rate stays a string. It is NUMERIC in the database and parsing it into
 * a Number on the way past is how a cent goes missing.
 */
export type Price = {
	service_id: string;
	entity_id: string | null;
	crew: string | null;
	rate: string;
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
		rows.find((p) => p.entity_id === entityId && p.crew === crew) ??
		rows.find((p) => p.entity_id === entityId && p.crew === null) ??
		rows.find((p) => p.entity_id === null && p.crew === crew) ??
		rows.find((p) => p.entity_id === null && p.crew === null);
	return pick?.rate ?? null;
}
