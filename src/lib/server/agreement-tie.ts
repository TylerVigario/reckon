import { pgError } from './field-errors.ts';
import { db } from './db/index.ts';

/**
 * Whether the database refused a save because it would make two agreements
 * tie for an hour: another of the client's, for the same place and starting
 * the same day, covering the same service (agreements_never_tie).
 */
export const isTie = (e: unknown) => pgError(e).constraint === 'agreements_never_tie';

/**
 * The agreement `agreementId` would tie with if it started on `startsOn` --
 * another of its client's, for the same place, starting that day -- and a
 * service both cover, named as the agreements list names them: its place, or
 * the whole client, and the service. Only `service`, where given, is asked
 * about; otherwise any this one covers. Undefined where none is found, as when
 * the other was changed since.
 */
export async function tiedWith(agreementId: string, startsOn: string, service?: string) {
	return db
		.selectFrom('agreement as a')
		.innerJoin('agreement as b', (j) =>
			j
				.onRef('b.entity_id', '=', 'a.entity_id')
				.on((eb) => eb('b.site_id', 'is not distinct from', eb.ref('a.site_id')))
				.onRef('b.id', '<>', 'a.id')
		)
		.innerJoin('agreement_service as t', 't.agreement_id', 'b.id')
		.innerJoin('service as sv', 'sv.id', 't.service_id')
		.leftJoin('site', 'site.id', 'b.site_id')
		.select(['site.display as place', 'sv.name as service'])
		.where('a.id', '=', agreementId)
		.where('b.starts_on', '=', startsOn)
		.$if(service !== undefined, (qb) => qb.where('t.service_id', '=', service!))
		.$if(service === undefined, (qb) =>
			qb.where('t.service_id', 'in', (eb) =>
				eb
					.selectFrom('agreement_service as s')
					.select('s.service_id')
					.whereRef('s.agreement_id', '=', 'a.id')
			)
		)
		.orderBy('sv.name')
		.limit(1)
		.executeTakeFirst();
}

/** Where the other agreement is for, as a person reads it. */
export const placeOf = (tie: { place: string | null }) => tie.place ?? 'the whole client';
