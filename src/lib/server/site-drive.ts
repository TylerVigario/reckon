import { eq } from 'drizzle-orm';
import { asUser, db } from './db/index.ts';
import { site } from './db/schema/index.ts';
import { operatorRow } from './operator.ts';
import { roundTrip, type Drive, type Waypoint } from './routes.ts';

/**
 * A SITE'S DRIVE (8 October 2026): from the business's own address to the site
 * and back, by Google's route (#lib/server/routes), worked out whenever a
 * site's place is chosen, so its round trip and drive time are Google's rather
 * than somebody's guess.
 *
 * GOOGLE'S STAYS IN VIEW (12 October 2026). A figure typed over Google's is
 * kept beside it, not in its place, so what is being disagreed with can still
 * be read; the typed one is in force until the site moves, and emptying it
 * puts Google's back.
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

/** Where a site is, to Google: the place chosen, or its address from before it had one. */
export function siteAt(s: {
	placeId: string | null;
	street: string;
	city: string;
	region: string | null;
	postcode: string;
}): Waypoint {
	return s.placeId
		? { placeId: s.placeId }
		: { address: `${s.street}, ${s.city}, ${s.region ?? ''} ${s.postcode}` };
}

/** How many sites are asked about at once. */
const AT_ONCE = 4;

/**
 * EVERY SITE AGAIN WHEN THE BUSINESS MOVES (12 October 2026). Google's drives
 * were measured from where the business was, so each is measured again from
 * where it is now, and one Google cannot say is emptied rather than left
 * measuring from somewhere else. What was typed stands.
 */
export async function measureEverySite(
	userId: string
): Promise<{ sites: number; unmeasured: number }> {
	const base = baseOf(await operatorRow());
	const all = await db
		.select({
			id: site.id,
			placeId: site.googlePlaceId,
			street: site.street,
			city: site.city,
			region: site.region,
			postcode: site.postcode,
			miles: site.googleRoundTripMiles,
			minutes: site.googleDriveMinutes
		})
		.from(site);

	const drives: (Drive | null)[] = [];
	if (base)
		for (let i = 0; i < all.length; i += AT_ONCE)
			drives.push(
				...(await Promise.all(all.slice(i, i + AT_ONCE).map((s) => roundTrip(base, siteAt(s)))))
			);

	// A site whose figures came out the same is not written, so a page open on
	// it is not told it is out of date by a change that changed nothing.
	await asUser(userId, async (tx) => {
		for (const [i, s] of all.entries()) {
			const miles = drives[i]?.miles ?? null;
			const minutes = drives[i]?.minutes ?? null;
			// Both to a tenth, as text: Google's toFixed(1) and numeric(8, 1) agree.
			if (miles === s.miles && minutes === s.minutes) continue;
			await tx
				.update(site)
				.set({ googleRoundTripMiles: miles, googleDriveMinutes: minutes })
				.where(eq(site.id, s.id));
		}
	});
	return { sites: all.length, unmeasured: all.length - drives.filter(Boolean).length };
}
