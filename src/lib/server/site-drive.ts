import { operatorRow } from './operator.ts';
import { roundTrip, type Drive, type Waypoint } from './routes.ts';

/**
 * A SITE'S DRIVE (8 October 2026): from the business's own address to the site
 * and back, by Google's route (#lib/server/routes), worked out whenever a
 * site's place is chosen, so its round trip and drive time are Google's rather
 * than somebody's guess. Both stay editable, and a figure typed over Google's
 * stands until the site moves again.
 */

/** Where the business's drives start and end: the place it chose, or its address from before it had one. */
export function baseOf(
	op: { google_place_id: string | null; address: string | null } | null
): Waypoint | null {
	return op?.google_place_id
		? { placeId: op.google_place_id }
		: op?.address
			? { address: op.address }
			: null;
}

/** Google's drive to a place, or why there is none, in the reader's words. */
export type Measured = { drive: Drive; why: null } | { drive: null; why: string };

export async function measureDrive(placeId: string): Promise<Measured> {
	const base = baseOf(await operatorRow());
	if (!base)
		return {
			drive: null,
			why: 'The business has no address to measure from. Set it in Settings → Business.'
		};
	const drive = await roundTrip(base, { placeId });
	return drive
		? { drive, why: null }
		: { drive: null, why: 'Google could not say how far it is. Type it if you know it.' };
}
