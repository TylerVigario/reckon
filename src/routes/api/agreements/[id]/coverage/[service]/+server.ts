import { and, eq } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import {
	agreement,
	agreementService,
	ALLOTMENTS,
	OVERAGES,
	service
} from '#lib/server/db/schema/index.ts';
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

	const [[isAgreement], [isService]] = await Promise.all([
		db.select({ id: agreement.id }).from(agreement).where(eq(agreement.id, params.id)),
		db.select({ id: service.id }).from(service).where(eq(service.id, params.service))
	]);
	if (!isAgreement || !isService) return problem('notFound', 404, 'No such agreement or service.');

	try {
		const allotment = {
			allotment: String(values.allotment) as (typeof ALLOTMENTS)[number],
			includedHours: values.included_hours === null ? null : String(values.included_hours),
			overage:
				values.overage === null ? null : (String(values.overage) as (typeof OVERAGES)[number])
		};
		await asUser(locals.user!.id, (tx) =>
			tx
				.insert(agreementService)
				.values({ agreementId: params.id, serviceId: params.service, ...allotment })
				.onConflictDoUpdate({
					target: [agreementService.agreementId, agreementService.serviceId],
					set: allotment
				})
		);
	} catch (e) {
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
			.delete(agreementService)
			.where(
				and(
					eq(agreementService.agreementId, params.id),
					eq(agreementService.serviceId, params.service)
				)
			)
			.returning({ id: agreementService.id })
	);
	if (gone.length === 0)
		return problem('notFound', 404, 'The agreement does not cover that service.');
	return Response.json({ removed: params.service });
};
