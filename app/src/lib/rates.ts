/**
 * What an hour of a service is worth to this client, for a crew of so many.
 *
 * The figures are worked out on the server by the valuation -- the one place a
 * price is resolved -- and handed to the page as strings, one for each size a
 * crew can be, so this only chooses: this client's price if it has one, else
 * the price for every client, for as many as are on it. The screens that ask --
 * starting a timer, entering past work, the timer running -- all ask here.
 *
 * Nothing is added up here: a crew's rate is already the first person's plus
 * each additional person's, worked out exactly.
 */
export type Price = {
	service_id: string;
	entity_id: string | null;
	/** The rate for a crew of each size: `byHeads[1]` for one person, `byHeads[2]` for two. */
	byHeads: (string | null)[];
};

export function rateFor(
	prices: Price[],
	serviceId: string | null,
	entityId: string | null,
	heads: number
): string | null {
	if (!serviceId) return null;
	const rows = prices.filter((p) => p.service_id === serviceId);
	const pick =
		rows.find((p) => p.entity_id !== null && p.entity_id === entityId) ??
		rows.find((p) => p.entity_id === null);
	if (!pick) return null;
	return pick.byHeads[Math.max(1, heads)] ?? null;
}
