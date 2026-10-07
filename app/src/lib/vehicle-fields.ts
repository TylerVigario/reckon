/**
 * What may be said about a vehicle: what it is called, and whose it is.
 *
 * Whose it is is said once, when it is added, and decides who its miles pay:
 * a person, or nobody for the business's own (0024). A vehicle that changes
 * hands is retired and added again. Retired says it is no longer driven; it
 * stays on the trips it was.
 */
import { anId, cap, flag, optional, parseIn, required, type Parsed } from './field-rules.ts';

export type { Parsed };

const name = required('A vehicle needs a name.', cap(40));

/** Adding one. An empty owner is the business. */
export const VEHICLE_FIELDS = { name, owner_id: optional(anId) };

/** Changing one: never whose it is. */
export const VEHICLE_CHANGES = { name, retired: flag };

export function parseVehicleChange(field: string, raw: string): Parsed {
	return parseIn(VEHICLE_CHANGES, field, raw);
}
