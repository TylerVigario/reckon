import { db } from '#lib/server/db/index.ts';
import { prices } from '#lib/server/catalogue.ts';
import { operatorRow } from '#lib/server/operator.ts';
import type { PageServerLoad } from './$types';

/**
 * Where trips start and end, what a mile is charged at, and how a trip's legs
 * are put to the clients they were driven for. The vehicles are on Vehicles.
 */
export const load: PageServerLoad = async () => {
	const [operator, mileage, priced] = await Promise.all([
		operatorRow(),
		db
			.selectFrom('service')
			.select(['id', 'name'])
			.where('unit', '=', 'mile')
			.where('active', '=', true)
			.orderBy('name')
			.execute(),
		prices()
	]);
	// The mileage rate is a service price, dated, like every other price: the
	// every-client price of each service charged per mile, in force or about to
	// be. What it used to be is that service's history, and a client's own
	// mileage price is on the services screen with the rest of its prices.
	const everyClient = priced.filter(
		(p) => p.client === null && mileage.some((m) => m.id === p.service_id)
	);
	const rates = everyClient
		.filter((p) => p.state !== 'superseded')
		.map((p) => ({ ...p, service: mileage.find((m) => m.id === p.service_id)!.name }));
	const history = mileage
		.map((m) => ({
			...m,
			earlier: everyClient.filter((p) => p.service_id === m.id && p.state === 'superseded').length
		}))
		.filter((m) => m.earlier > 0);
	return { operator, rates, history };
};
