import { fiscalYear, lastFullMonth } from '$lib/server/periods';
import { scheduleA, partnerPay, remoteMeter, nonBillable } from '$lib/server/reports';
import type { PageServerLoad } from './$types';

/**
 * The index carries each report's headline figure, computed by the same
 * function the report itself uses. A summary computed a second way is a bug
 * that takes a year to find, and it is found by an outside party.
 */
export const load: PageServerLoad = async () => {
	const [fy, month] = await Promise.all([fiscalYear(), lastFullMonth()]);
	const [a, pay, meter, given] = await Promise.all([
		fy ? scheduleA(fy) : Promise.resolve(null),
		partnerPay(month),
		remoteMeter(month),
		nonBillable(month)
	]);

	return {
		fy,
		month,
		scheduleA: a && { due: a.due, unchecked: a.unchecked.length },
		pay: { due: pay.due },
		meter: { charged: meter.charged },
		given
	};
};
