import { normalizeIP } from '@better-auth/core/utils/ip';

/**
 * The address as Postgres keeps it, and the network it is counted in: an IPv6
 * address by its /64, which one household or phone holds the whole of, and an
 * IPv4 one by itself. An IPv4 address carried in IPv6 is the IPv4 address, and
 * a zone index, which only a link-local address has, is no part of where it
 * came from. What a wrong code from an emailed link counts against
 * (#lib/server/links).
 */
export function placeOf(address: string): { address: string; network: string } {
	const bare = address.replace(/%.*$/, '');
	const network = normalizeIP(bare);
	return network.includes(':')
		? { address: bare, network: `${network}/64` }
		: { address: network, network: `${network}/32` };
}
