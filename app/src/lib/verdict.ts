/**
 * What address validation said, as it crosses the wire.
 *
 * Shared because both ends need it and neither owns it: the server builds one
 * in $lib/server/validate-address and AddressField reads one back from
 * /api/address. It was declared twice -- and the copy in the component had
 * already lost `inferred`, so a field the server sends had no reader.
 */
export type Verdict = {
	/** Google's own view, unsummarised, so a caller can disagree with mine. */
	complete: boolean;
	/** It found something to change -- a spelling, a missing unit, a ZIP+4. */
	corrected: boolean;
	/** Nothing was inferred that the typist did not supply. */
	inferred: boolean;
	formatted: string | null;
	unconfirmed: string[];
};
