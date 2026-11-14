/**
 * SERVICES ADDED ON THIS PHONE, usable at once: what the timer, Add time and
 * New trip offer is what the server last said, with each service still waiting
 * here among them, by the uuid made for it, and its price for every client as
 * it was given -- for the first person, and each one after. An entry or a trip
 * naming one waits for it (#lib/queue), and is priced again when it arrives.
 */
import { Decimal } from './decimal.ts';
import type { ServiceEntry } from './queue.ts';

/** What a crew of each size pays for one of it: none for nobody, then 1, 2, … */
type Priced = { service_id: string; entity_id: string | null; byHeads: (string | null)[] };

/** Each service added here, as a choice: by the uuid made for it. */
export function servicesAdded<T extends { id: string; name: string }>(
	services: readonly T[],
	held: readonly ServiceEntry[],
	as: (s: ServiceEntry) => T,
	only: (s: ServiceEntry) => boolean = () => true
): T[] {
	const known = new Set(services.map((s) => s.id));
	return [...services, ...held.filter((s) => only(s) && !known.has(s.client_uuid)).map(as)].sort(
		(a, b) => a.name.localeCompare(b.name)
	);
}

/**
 * The prices a screen chooses from, with every client's price of each service
 * added here: `heads` the most a crew can be, as the server's own run to.
 */
export function pricesAdded(
	prices: readonly Priced[],
	held: readonly ServiceEntry[],
	heads: number
): Priced[] {
	return [
		...prices,
		...held
			.filter((s) => s.fields.rate !== '')
			.map((s) => ({
				service_id: s.client_uuid,
				entity_id: null,
				byHeads: Array.from({ length: Math.max(heads, 1) + 1 }, (_, n) =>
					n === 0
						? null
						: Decimal.from(s.fields.rate)
								.add(Decimal.from(s.fields.additional_rate || '0').mul(BigInt(n - 1)))
								.toString()
				)
			}))
	];
}
