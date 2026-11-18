import { asUser, db } from '#lib/server/db/index.ts';
import type { Allotment, Overage } from '#lib/server/db/database.ts';
import { isTie, placeOf, tiedWith } from '#lib/server/agreement-tie.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { COVERAGE_FIELDS, readCoverage } from '#lib/agreement-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * One service an agreement covers, and its allotment: PUT sets it whole --
 * covering the service if it was not, changing the allotment if it was --
 * and DELETE stops covering it, so its hours are billed again.
 *
 * Whole, because the allotment is one decision: a cap is its hours and what
 * happens past them, or it is unlimited and has neither.
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.service))
		return problem('notFound', 404, 'No such agreement or service.');

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');
	const { values, errors } = readCoverage(fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [isAgreement, isService] = await Promise.all([
		db
			.selectFrom('agreement')
			.select(['id', 'starts_on'])
			.where('id', '=', params.id)
			.executeTakeFirst(),
		db.selectFrom('service').select('id').where('id', '=', params.service).executeTakeFirst()
	]);
	if (!isAgreement || !isService) return problem('notFound', 404, 'No such agreement or service.');

	try {
		const allotment = {
			allotment: String(values.allotment) as Allotment,
			included_hours: values.included_hours === null ? null : String(values.included_hours),
			overage: values.overage === null ? null : (String(values.overage) as Overage)
		};
		await asUser(locals.user!.id, (tx) =>
			tx
				.insertInto('agreement_service')
				.values({ agreement_id: params.id, service_id: params.service, ...allotment })
				.onConflict((oc) =>
					oc.columns(['agreement_id', 'service_id']).doUpdateSet((eb) => ({
						allotment: eb.ref('excluded.allotment'),
						included_hours: eb.ref('excluded.included_hours'),
						overage: eb.ref('excluded.overage')
					}))
				)
				.execute()
		);
	} catch (e) {
		// Another of the client's agreements, for the same place and from the
		// same day, covers it: named, so it can be found and one of them put right.
		if (isTie(e)) {
			const tie = await tiedWith(params.id, isAgreement.starts_on, params.service);
			return refuse({
				service: tie
					? `${tie.service} is covered already, from the same day, by this client’s other agreement for ${placeOf(tie)}. Cover it on one of them, or start this one on another day.`
					: 'Another of this client’s agreements, for the same place and from the same day, covers it already.'
			});
		}
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(COVERAGE_FIELDS), 'agreement_service');
		if (refused) return refused;
		throw e;
	}
	return Response.json({ saved: values });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.service))
		return problem('notFound', 404, 'No such agreement or service.');
	const gone = await asUser(locals.user!.id, (tx) =>
		tx
			.deleteFrom('agreement_service')
			.where('agreement_id', '=', params.id)
			.where('service_id', '=', params.service)
			.returning('id')
			.execute()
	);
	if (gone.length === 0)
		return problem('notFound', 404, 'The agreement does not cover that service.');
	return Response.json({ removed: params.service });
};
