import { sql } from 'kysely';
import { asUser, db, type Tx } from './db/index.ts';
import { businessToday } from './calendar.ts';
import { pgError } from './field-errors.ts';
import { taxDraftsAgain } from './lines.ts';
import { collecting } from './tax-registrations.ts';
import { stateName } from '../us-states.ts';
import type { ExemptionFields } from '../exemption-fields.ts';

/**
 * A CLIENT'S EXEMPTIONS, each a state's (20261125T0423Z): recorded from the
 * certificate, ended on the day it is revoked, or taken off where nothing that
 * went out was untaxed by it -- recorded by mistake. Each holds the client,
 * then its drafts, and taxes those again in the exemption's state
 * (#lib/server/lines taxDraftsAgain), in one transaction: a line being added
 * holds the client too, so it is taxed as the exemptions stand either side of
 * the change, never between.
 */

/** Refused, by the field it is about. */
export class Refused extends Error {
	constructor(
		readonly field: string,
		message: string
	) {
		super(message);
	}
}

/**
 * A client's exemptions, those in force first, each oldest first: and whether
 * an invoice that went out was untaxed by it, which keeps it.
 */
export async function exemptionsOf(entityId: string) {
	return db
		.selectFrom('tax_exemption as x')
		.select((eb) => [
			'x.id',
			'x.state',
			'x.reason',
			'x.explanation',
			'x.supported_by',
			'x.sale_kind_ids as kinds',
			'x.ended_on',
			eb
				.exists(
					eb
						.selectFrom('invoice_line as il')
						.innerJoin('invoice as i', 'i.id', 'il.invoice_id')
						.select('il.id')
						.whereRef('il.tax_exemption_id', '=', 'x.id')
						.where('i.status', '<>', 'draft')
				)
				.as('billed')
		])
		.where('x.entity_id', '=', entityId)
		.orderBy(sql`x.ended_on is not null`)
		.orderBy('x.id')
		.execute();
}

/** The client held, against lines being added to its drafts meanwhile (#lib/server/lines heldFor). */
const hold = (tx: Tx, entityId: string) =>
	tx.selectFrom('entity').select('id').where('id', '=', entityId).forNoKeyUpdate().execute();

/** Its drafts taxed again, or refused where a line would be taxed at a site in no area yet. */
async function again(tx: Tx, entityId: string, state: string) {
	const site = await taxDraftsAgain(tx, entityId, state);
	if (site)
		throw new Refused(
			'exemption',
			`${site} is in no tax area yet, and a line on a draft there would be taxed again. Place the site first, on its Tax tab.`
		);
}

/**
 * Records an exemption from the certificate, in a state the business collects
 * in -- anywhere else there is nothing to be exempt from -- and untaxes what
 * it covers on the client's drafts there.
 */
export async function recordExemption(
	userId: string,
	entityId: string,
	x: ExemptionFields
): Promise<string> {
	if (!(await collecting(db)).includes(x.state))
		throw new Refused(
			'state',
			`The business doesn’t collect in ${stateName(x.state)}, so nothing is taxed there to be exempt from.`
		);
	try {
		return await asUser(userId, async (tx) => {
			await hold(tx, entityId);
			const { id } = await tx
				.insertInto('tax_exemption')
				.values({
					entity_id: entityId,
					state: x.state,
					reason: x.reason,
					explanation: x.explanation,
					supported_by: x.supported_by,
					sale_kind_ids: x.kinds
				})
				.returning('id')
				.executeTakeFirstOrThrow();
			await again(tx, entityId, x.state);
			return id;
		});
	} catch (e) {
		if (pgError(e).constraint === 'an_exemption_names_kinds')
			throw new Refused('kinds', 'One of those kinds of sale no longer exists.');
		throw e;
	}
}

/**
 * Ends an exemption today, the business's day, as its revocation is received:
 * what its client's drafts there are untaxed by it is taxed as its kind is.
 * One already ended is what was asked. False where the client has no such
 * exemption.
 */
export async function endExemption(userId: string, entityId: string, id: string) {
	return asUser(userId, async (tx) => {
		await hold(tx, entityId);
		const x = await tx
			.selectFrom('tax_exemption')
			.select(['state', 'ended_on'])
			.where('id', '=', id)
			.where('entity_id', '=', entityId)
			.executeTakeFirst();
		if (!x) return false;
		if (x.ended_on !== null) return true;
		await tx
			.updateTable('tax_exemption')
			.set({ ended_on: businessToday() })
			.where('id', '=', id)
			.execute();
		await again(tx, entityId, x.state);
		return true;
	});
}

/**
 * Takes off an exemption recorded by mistake, its client's drafts there taxed
 * again without it. One an invoice that went out was untaxed by stays with that
 * invoice, and is ended instead. False where the client has no such exemption.
 */
export async function removeExemption(userId: string, entityId: string, id: string) {
	try {
		return await asUser(userId, async (tx) => {
			await hold(tx, entityId);
			const x = await tx
				.selectFrom('tax_exemption')
				.select(['state', 'ended_on'])
				.where('id', '=', id)
				.where('entity_id', '=', entityId)
				.executeTakeFirst();
			if (!x) return false;
			// No longer in force first, so its drafts are taxed again without it.
			if (x.ended_on === null)
				await tx
					.updateTable('tax_exemption')
					.set({ ended_on: businessToday() })
					.where('id', '=', id)
					.execute();
			await again(tx, entityId, x.state);
			await tx.deleteFrom('tax_exemption').where('id', '=', id).execute();
			return true;
		});
	} catch (e) {
		if (pgError(e).constraint === 'invoice_line_tax_exemption_id_fkey')
			throw new Refused(
				'exemption',
				'An invoice that went out was untaxed by it, so it stays with that invoice. End it instead.'
			);
		throw e;
	}
}
