import { Decimal } from './decimal.ts';

/**
 * A TRIP'S LEGS, EACH TO WHOEVER CAUSED IT: the rule Settings → Travel names,
 * "assign each leg to whoever caused it", worked out the same way on the phone
 * and on the server.
 *
 * A trip is the drives between its places: from where it started to the first
 * stop, stop to stop, and from the last stop to where it ended. Each drive is
 * given whole, or split, so a trip never bills more miles than were driven.
 *
 *   one client        both ways are theirs: out and back
 *   A then B          the drive to A is A's; A to B is B's; the way back is B's,
 *                     who made it longer
 *   two at one stop   the drives there and back are split between them
 *   asked once there  nothing is theirs: the drive was happening anyway
 *   nobody's errand   the drive to it is nobody's, and so is the way back
 *
 * Whoever records the trip can give a drive to someone else instead, split it
 * among others, or give it to nobody; the leg then says it was chosen.
 */

export type Visit = { entityId: string; siteId: string | null; askedThere: boolean };

/** A place the trip stopped, and who it was for there. */
export type Stop = { visits: readonly Visit[] };

/**
 * A drive, in order: drive i goes to stop i, and the last one is the way back
 * to where the trip ended. `to` is who it was given to by hand -- [] for nobody
 * -- and absent while the rule decides.
 */
export type Drive = { miles: string; to?: readonly string[] | null };

export type LegRule =
	'house_to_a' | 'a_to_b' | 'b_to_house' | 'round_trip' | 'split' | 'unassigned' | 'chosen';

export type Leg = {
	/** Which drive it is part of: a split drive is a leg for each client. */
	drive: number;
	entityId: string | null;
	siteId: string | null;
	rule: LegRule;
	miles: string;
};

/** Who caused the drive to a stop: everyone it was for who asked before the driver left. */
const causedBy = (stop: Stop | undefined) => {
	const seen = new Set<string>();
	return (stop?.visits ?? []).filter(
		(v) => !v.askedThere && !seen.has(v.entityId) && seen.add(v.entityId)
	);
};

/** `miles` in `ways` parts to the hundredth, the first parts taking what does not divide. */
export function shares(miles: string, ways: number): string[] {
	const whole = Decimal.from(miles).round(2);
	const each = whole.div(ways).round(2, 'down');
	let left = whole.sub(each.mul(ways));
	const cent = Decimal.from('0.01');
	return Array.from({ length: ways }, () => {
		if (left.gt(0)) {
			left = left.sub(cent);
			return each.add(cent).toFixed(2);
		}
		return each.toFixed(2);
	});
}

/**
 * The legs of a trip with these stops and drives. There is one drive more than
 * there are stops; with fewer, the trip is not finished and has no legs yet.
 */
export function legsOf(stops: readonly Stop[], drives: readonly Drive[]): Leg[] {
	if (!stops.length || drives.length !== stops.length + 1) return [];
	const last = stops.length;
	const siteOf = (entityId: string) =>
		stops.flatMap((s) => s.visits).find((v) => v.entityId === entityId && v.siteId)?.siteId ?? null;
	const legs: Leg[] = [];
	drives.forEach((d, i) => {
		const given = d.to ?? null;
		// The way back is caused by whoever the last stop was for.
		const who = given
			? given.map((entityId) => ({ entityId, siteId: siteOf(entityId) }))
			: causedBy(stops[i === last ? last - 1 : i]);
		const solo = stops.length === 1;
		const rule: LegRule = given
			? 'chosen'
			: who.length === 0
				? 'unassigned'
				: who.length > 1
					? 'split'
					: solo
						? 'round_trip'
						: i === 0
							? 'house_to_a'
							: i === last
								? 'b_to_house'
								: 'a_to_b';
		if (who.length === 0) {
			legs.push({ drive: i, entityId: null, siteId: null, rule, miles: shares(d.miles, 1)[0] });
			return;
		}
		const parts = shares(d.miles, who.length);
		who.forEach((w, k) =>
			legs.push({ drive: i, entityId: w.entityId, siteId: w.siteId, rule, miles: parts[k] })
		);
	});
	return legs;
}

/** Where a drive starts or ends: the base, a site, or an address that is nobody's site. */
export type Place = { site: string } | { address: string } | 'base';

export const placeKey = (p: Place) =>
	p === 'base'
		? 'base'
		: 'site' in p
			? `site:${p.site}`
			: `address:${p.address.trim().toLowerCase().replace(/\s+/g, ' ')}`;

/** A drive between two places, either way round: one key. */
export const driveKey = (a: Place, b: Place) => [placeKey(a), placeKey(b)].sort().join(' ~ ');

/** A drive's miles before anyone types them, and where they came from. */
export type Estimate = { miles: string; from: 'last' | 'site'; on?: string };

/**
 * What a drive between these places most likely was: as it was last driven,
 * or half the site's round trip when it runs between the base and a site.
 * Nothing otherwise: somebody types it.
 */
export function estimate(
	from: Place,
	to: Place,
	known: Readonly<Record<string, { miles: string; on: string }>>,
	roundTrips: Readonly<Record<string, string | null>>
): Estimate | null {
	const last = known[driveKey(from, to)];
	if (last) return { miles: Decimal.from(last.miles).toFixed(1), from: 'last', on: last.on };
	const site = from === 'base' && to !== 'base' && 'site' in to ? to.site : null;
	const back = to === 'base' && from !== 'base' && 'site' in from ? from.site : null;
	const round = roundTrips[site ?? back ?? ''];
	if (round) return { miles: Decimal.from(round).div(2).round(1).toFixed(1), from: 'site' };
	return null;
}
