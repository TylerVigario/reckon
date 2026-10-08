import { and, eq } from 'drizzle-orm';
import { Decimal, sum } from '#lib/decimal.ts';
import { UUID } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
import { asUser } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { pgError, refuse } from '#lib/server/field-errors.ts';
import { owed } from '#lib/server/pay.ts';
import { problem } from '#lib/server/problem.ts';
import type { RequestHandler } from './$types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^-?\d{1,9}(\.\d+)?$/;
const text = (v: unknown, cap: number) =>
	typeof v === 'string' && v.trim() && v.trim().length <= cap ? v.trim() : null;
const ids = (v: unknown) =>
	Array.isArray(v) && v.length <= 1000 && v.every((x) => typeof x === 'string' && UUID.test(x))
		? (v as string[])
		: null;

/**
 * Records a payment made to one person: the day, how, a note, the work it
 * covers -- entries and trips from what they are owed -- and, if there is one,
 * a correction to an earlier payment of theirs. Every figure is worked out here
 * (#lib/server/pay), not taken from the page, and kept as it was: a later role
 * or rule moves only what is still owed. A payment sent twice with one id is
 * one payment.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await readBody(request);
	if (!body) return problem('malformed', 400, 'Expected a payment.');
	const errors: Record<string, string> = {};
	const no = (field: string, why: string) => ((errors[field] ??= why), null);

	const clientUuid =
		typeof body.client_uuid === 'string' && UUID.test(body.client_uuid)
			? body.client_uuid
			: no('client_uuid', 'Expected the id it was made with.');
	const userId =
		typeof body.user_id === 'string' && UUID.test(body.user_id)
			? body.user_id
			: no('user_id', 'Who was paid.');
	const today = businessToday();
	const paidOn =
		typeof body.paid_on === 'string' && DAY.test(body.paid_on) && body.paid_on <= today
			? body.paid_on
			: no('paid_on', 'The day it was paid. It cannot be in the future.');
	const how = text(body.how, 40) ?? no('how', 'How it was paid.');
	const note =
		body.note === null || body.note === undefined || body.note === ''
			? null
			: (text(body.note, 500) ?? no('note', 'At most 500 characters.'));
	const entries = ids(body.entries ?? []) ?? no('entries', 'The entries it covers, by their ids.');
	const trips = ids(body.trips ?? []) ?? no('trips', 'The trips it covers, by their ids.');

	const places = await moneyPlaces();
	const c = body.correction as Record<string, unknown> | null | undefined;
	let correction: { paymentId: string; amount: Decimal; why: string } | null = null;
	if (c && typeof c === 'object') {
		const paymentId =
			typeof c.payment_id === 'string' && UUID.test(c.payment_id)
				? c.payment_id
				: no('correction', 'Which payment it corrects.');
		const raw = typeof c.amount === 'string' ? c.amount.trim() : '';
		const amount =
			AMOUNT.test(raw) && !Decimal.from(raw).isZero() && Decimal.from(raw).round(places).eq(raw)
				? Decimal.from(raw)
				: no('correction', `An amount, plus or minus, to at most ${places} places.`);
		const why = text(c.why, 200) ?? no('correction', 'Why it is corrected.');
		if (paymentId && amount && why) correction = { paymentId, amount, why };
	}
	if (Object.keys(errors).length) return refuse(errors);
	if (!entries!.length && !trips!.length && !correction)
		return refuse({ entries: 'Tick what it covers, or add a correction.' });

	// What this person is owed now, item by item: what the payment may cover.
	const theirs = (await owed([userId!])).get(userId!) ?? [];
	const asked = [
		...entries!.map((id) => ({ kind: 'time' as const, id })),
		...trips!.map((id) => ({ kind: 'trip' as const, id }))
	];
	const items = asked.map((a) => theirs.find((o) => o.kind === a.kind && o.id === a.id));
	if (items.some((i) => !i || i.amount === null))
		return problem(
			'conflict',
			409,
			'Something it covers is paid already, or no rule pays it. Open the page again.'
		);
	const total = sum(items.map((i) => i!.amount)).add(correction?.amount ?? Decimal.ZERO);
	if (total.lt(0))
		return refuse({
			correction:
				'This payment would come to less than nothing. Take the rest off the payment after it.'
		});

	try {
		const made = await asUser(locals.user!.id, async (tx) => {
			if (correction) {
				const [earlier] = await tx
					.select({ paidOn: t.personPayment.paidOn })
					.from(t.personPayment)
					.where(
						and(eq(t.personPayment.id, correction.paymentId), eq(t.personPayment.userId, userId!))
					);
				if (!earlier || earlier.paidOn > paidOn!) return 'not-theirs' as const;
			}
			const [row] = await tx
				.insert(t.personPayment)
				.values({
					userId: userId!,
					paidOn: paidOn!,
					how: how!,
					note,
					clientUuid: clientUuid!,
					createdBy: locals.user!.id
				})
				.onConflictDoNothing({ target: t.personPayment.clientUuid })
				.returning({ id: t.personPayment.id });
			// A repeat is the payment already there, answered as if just written.
			if (!row) {
				const [was] = await tx
					.select({ id: t.personPayment.id })
					.from(t.personPayment)
					.where(eq(t.personPayment.clientUuid, clientUuid!));
				return { id: was.id, repeat: true };
			}
			const rows = [
				...items.map((i) => ({
					paymentId: row.id,
					userId: userId!,
					timeEntryId: i!.kind === 'time' ? i!.id : null,
					tripId: i!.kind === 'trip' ? i!.id : null,
					amount: i!.amount!,
					said: i!.said
				})),
				...(correction
					? [
							{
								paymentId: row.id,
								userId: userId!,
								correctsPaymentId: correction.paymentId,
								amount: correction.amount.toString(),
								said: correction.why
							}
						]
					: [])
			];
			await tx.insert(t.personPaymentItem).values(rows);
			return { id: row.id, repeat: false };
		});
		if (made === 'not-theirs')
			return refuse({ correction: "That is not one of this person's earlier payments." });
		return Response.json({ id: made.id }, { status: made.repeat ? 200 : 201 });
	} catch (err) {
		// Two people recording the same work at once: the second finds it paid.
		if (pgError(err).code === '23505')
			return problem(
				'conflict',
				409,
				'Something it covers was paid just now. Open the page again.'
			);
		throw err;
	}
};
