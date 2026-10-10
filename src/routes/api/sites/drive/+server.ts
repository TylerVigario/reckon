import { readFields } from '#lib/json.ts';
import { parseSiteField } from '#lib/site-fields.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { measureDrive } from '#lib/server/site-drive.ts';
import type { RequestHandler } from './$types';

/**
 * How far a place is, before it is a site (#lib/server/site-drive): New site
 * asks the moment a place is chosen, so the round trip and drive time are there
 * to be seen, and typed over, before anything is saved. Google's route there
 * and back from the business; nulls, and why, when it cannot be said.
 */
export const POST: RequestHandler = async ({ request }) => {
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');
	const raw = fields.google_place_id;
	const parsed = parseSiteField('google_place_id', typeof raw === 'string' ? raw : '');
	if (!parsed.ok) return refuse({ google_place_id: parsed.why });

	const { drive, why } = await measureDrive(String(parsed.value));
	return Response.json(
		{ round_trip_miles: drive?.miles ?? null, drive_minutes: drive?.minutes ?? null, why },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
