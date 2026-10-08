import { UUID } from '#lib/field-rules.ts';
import type { Drive, Stop } from '#lib/trip-legs.ts';

/**
 * A trip as the New trip form sends it, read and checked before anything is
 * written: every refusal names the field it is about, in words a person can
 * act on, as a time entry's do (#routes/api/time).
 */
export type TripInput = {
	clientUuid: string;
	travelledOn: string;
	drivenBy: string;
	vehicleId: string | null;
	serviceId: string | null;
	startAddress: string | null;
	endAddress: string | null;
	odometerStart: string | null;
	odometerEnd: string | null;
	note: string | null;
	stops: (Stop & { siteId: string | null; address: string | null })[];
	drives: Drive[];
};

const MILES = /^\d{1,4}(\.\d{1,2})?$/;
const ODOMETER = /^\d{1,8}(\.\d)?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, cap: number) =>
	typeof v === 'string' && v.trim() && v.trim().length <= cap ? v.trim() : null;
const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);

export function readTrip(
	body: Record<string, unknown> | null
): { ok: true; trip: TripInput } | { ok: false; errors: Record<string, string> } {
	const errors: Record<string, string> = {};
	const no = (field: string, why: string) => ((errors[field] ??= why), null);
	if (!body) return { ok: false, errors: { trip: 'Expected a trip.' } };

	const clientUuid = id(body.client_uuid) ?? no('client_uuid', 'Expected the id it was made with.');
	const travelledOn =
		typeof body.travelled_on === 'string' &&
		DAY.test(body.travelled_on) &&
		!Number.isNaN(Date.parse(body.travelled_on))
			? body.travelled_on
			: no('travelled_on', 'Which day it was driven.');
	const drivenBy = id(body.driven_by) ?? no('driven_by', 'Who drove.');
	const optionalId = (field: string) =>
		body[field] === null || body[field] === undefined || body[field] === ''
			? null
			: (id(body[field]) ?? no(field, 'That is not one of ours.'));
	const vehicleId = optionalId('vehicle_id');
	const serviceId = optionalId('service_id');
	const optionalText = (field: string, cap: number) =>
		body[field] === null || body[field] === undefined || body[field] === ''
			? null
			: (text(body[field], cap) ?? no(field, `At most ${cap} characters.`));
	const startAddress = optionalText('start_address', 200);
	const endAddress = optionalText('end_address', 200);
	const note = optionalText('note', 500);

	const reading = (field: string) =>
		body[field] === null || body[field] === undefined || body[field] === ''
			? null
			: typeof body[field] === 'string' && ODOMETER.test(body[field].replace(/,/g, ''))
				? body[field].replace(/,/g, '')
				: no(field, 'Miles on the odometer, to a tenth at most.');
	const odometerStart = reading('odometer_start');
	const odometerEnd = reading('odometer_end');
	if ((odometerStart === null) !== (odometerEnd === null) && !errors.odometer_start)
		no(odometerStart === null ? 'odometer_start' : 'odometer_end', 'Both readings, or neither.');
	else if (odometerStart !== null && odometerEnd !== null && +odometerEnd < +odometerStart)
		no('odometer_end', 'Less than it read when the trip left.');

	const stops: TripInput['stops'] = [];
	if (!Array.isArray(body.stops) || body.stops.length === 0 || body.stops.length > 25)
		no('stops', 'Where it went: a stop at least, and at most 25.');
	else
		for (const raw of body.stops as unknown[]) {
			const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
			const siteId = s.site_id ? id(s.site_id) : null;
			const address = s.address ? text(s.address, 200) : null;
			if ((siteId === null) === (address === null)) {
				no('stops', 'A stop is a site, or an address -- one of the two.');
				break;
			}
			const visits = Array.isArray(s.clients) ? (s.clients as unknown[]) : null;
			if (!visits) {
				no('stops', 'Who each stop was for.');
				break;
			}
			const parsed = visits.map((v) => {
				const c = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
				return {
					entityId: id(c.entity_id),
					siteId: c.site_id ? id(c.site_id) : null,
					askedThere: c.asked_there === true
				};
			});
			if (parsed.some((v) => v.entityId === null || (v.siteId === null && siteId !== null))) {
				no('stops', 'Who each stop was for, by their ids.');
				break;
			}
			stops.push({
				siteId,
				address,
				// A client named twice at one stop is there once.
				visits: parsed
					.filter((v, k) => parsed.findIndex((w) => w.entityId === v.entityId) === k)
					.map((v) => ({ ...v, entityId: v.entityId! }))
			});
		}

	const drives: Drive[] = [];
	const clients = new Set(stops.flatMap((s) => s.visits.map((v) => v.entityId)));
	if (!Array.isArray(body.drives) || body.drives.length !== stops.length + 1)
		no('drives', 'The miles of each drive: one more than there are stops.');
	else
		for (const raw of body.drives as unknown[]) {
			const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
			const m = typeof d.miles === 'string' ? d.miles.trim() : '';
			if (!MILES.test(m)) {
				no('drives', 'Miles, to a hundredth at most, for every drive.');
				break;
			}
			const to = d.to === null || d.to === undefined ? null : Array.isArray(d.to) ? d.to : false;
			if (to === false || (to && to.some((e) => typeof e !== 'string' || !clients.has(e)))) {
				no('drives', 'A drive is given to someone the trip was for.');
				break;
			}
			drives.push({ miles: m, to: to as string[] | null, estimated: d.estimated === true });
		}

	if (Object.keys(errors).length) return { ok: false, errors };
	return {
		ok: true,
		trip: {
			clientUuid: clientUuid!,
			travelledOn: travelledOn!,
			drivenBy: drivenBy!,
			vehicleId,
			serviceId,
			startAddress,
			endAddress,
			odometerStart,
			odometerEnd,
			note,
			stops,
			drives
		}
	};
}
