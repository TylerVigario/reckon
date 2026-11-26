/**
 * A CLIENT'S EXEMPTION, as a person records it from the certificate
 * (#lib/server/exemptions): the state it is claimed in, why, what supports
 * it, and the kinds of sale it covers. The page and its endpoint both import
 * this, so the page answers as a person types and the endpoint checks again.
 *
 * ONLY THESE KEYS CAN BE WRITTEN. A field named in a request is looked up here
 * and nowhere else.
 */
import {
	anId,
	cap,
	no,
	ok,
	oneOf,
	optional,
	parseAll,
	required,
	type Parse
} from './field-rules.ts';
import { isState } from './us-states.ts';
import type { ExemptionReason } from './server/db/database.ts';

/**
 * Why, as the Streamlined certificate lists it (SSTGB Form F0003, s. 4), Other
 * last. California asks the purpose too (Reg 1667 (c)(1)).
 */
export const REASONS: readonly { value: ExemptionReason; label: string }[] = [
	{ value: 'federal_government', label: 'Federal government' },
	{ value: 'state_or_local_government', label: 'State or local government' },
	{ value: 'tribal_government', label: 'Tribal government' },
	{ value: 'foreign_diplomat', label: 'Foreign diplomat' },
	{ value: 'charitable', label: 'Charitable organization' },
	{ value: 'religious', label: 'Religious organization' },
	{ value: 'educational', label: 'Educational organization' },
	{ value: 'resale', label: 'Resale' },
	{ value: 'agricultural_production', label: 'Agricultural production' },
	{ value: 'industrial_production', label: 'Industrial production or manufacturing' },
	{ value: 'direct_pay_permit', label: 'Direct pay permit' },
	{ value: 'direct_mail', label: 'Direct mail' },
	{ value: 'other', label: 'Other' }
];

/** A reason in words: "Resale". */
export const reasonSaid = (r: string) => REASONS.find((x) => x.value === r)?.label ?? r;

/** What the certificate says of it, as each reason asks: F0003 names a department or a government. */
export function explainedAs(reason: string): string {
	if (reason === 'federal_government') return 'The department, as the certificate names it.';
	if (reason === 'state_or_local_government' || reason === 'tribal_government')
		return 'The government, as the certificate names it.';
	if (reason === 'other') return 'What the exemption is, as the certificate says.';
	return 'Anything more the certificate says of it.';
}

/** What supports it, as each reason has it. */
export function supportedAs(reason: string): string {
	if (reason === 'federal_government')
		return 'What its purchase orders or payments are under: CDTFA asks for those, not a certificate.';
	if (reason === 'resale') return 'Their seller’s permit number, as the certificate gives it.';
	return 'The certificate’s number, or what else supports it.';
}

const aState: Parse = (v) => (isState(v) ? ok(v) : no('That is not a state.'));

export const EXEMPTION_FIELDS = {
	state: required('Which state it is claimed in.', aState),
	reason: required('Why, as the certificate says.', oneOf(REASONS.map((r) => r.value))),
	explanation: optional(cap(200)),
	supported_by: required('Its number, or what else supports it.', cap(60))
};

export type ExemptionFields = {
	state: string;
	reason: ExemptionReason;
	explanation: string | null;
	supported_by: string;
	/** The kinds of sale it covers, or null for every kind. */
	kinds: string[] | null;
};

/**
 * An exemption as it was sent: { fields: { state, reason, explanation,
 * supported_by }, kinds: null for every kind of sale, or the ids of those it
 * covers }. Other is explained, and an exemption for some kinds names one.
 */
export function parseExemption(
	fields: Record<string, unknown>,
	kinds: unknown
): { value: ExemptionFields | null; errors: Record<string, string> } {
	const { values, errors } = parseAll(EXEMPTION_FIELDS, fields);
	if (values.reason === 'other' && values.explanation === null && !errors.explanation)
		errors.explanation = 'What the exemption is, as the certificate says.';
	let covers: string[] | null = null;
	if (kinds !== null) {
		const ids = Array.isArray(kinds) ? kinds : [];
		const read = ids.map((k) => (typeof k === 'string' ? anId(k) : no('That is not one of ours.')));
		const bad = read.find((r) => !r.ok);
		if (bad && !bad.ok) errors.kinds = bad.why;
		else if (read.length === 0) errors.kinds = 'Which kinds of sale it covers.';
		else covers = [...new Set(read.map((r) => String(r.ok && r.value)))];
	}
	if (Object.keys(errors).length) return { value: null, errors };
	return {
		value: {
			state: String(values.state),
			reason: values.reason as ExemptionReason,
			explanation: values.explanation === null ? null : String(values.explanation),
			supported_by: String(values.supported_by),
			kinds: covers
		},
		errors
	};
}
