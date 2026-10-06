import type { MergedField } from './line-merge.ts';

/**
 * WHAT A CHANGE MADE ON A PHONE RAN INTO, as the server says it and the phone
 * keeps it until a person decides (#lib/queue). One shape both sides read, as
 * #lib/problem is for refusals.
 *
 *   collided  a field both the phone and someone else changed differently:
 *             every value it has held, to pick from. What merged on its own
 *             is said too, and the line as the server has it now, so the
 *             change can be made again against that.
 *   removed   the line was taken off meanwhile: put it back with the change,
 *             or let the change go.
 *   changed   a line taken off on the phone was changed meanwhile: take it
 *             off anyway, or keep it.
 */

/** A value a field has held: what, who set it, when it arrived and when it was made. */
export type Held = {
	value: string;
	who: string | null;
	at: string;
	/** When it was made on a phone, where it was. */
	made_at: string | null;
};

export type Conflict =
	| {
			what: 'collided';
			/** The line's save the server is at, and its fields: what a pick is made against. */
			version: number;
			server: Record<string, string>;
			/** Each field that collided: what both began from, the phone's, the server's, and every value held. */
			fields: Partial<
				Record<MergedField, { base: string; mine: string; theirs: string; chain: Held[] }>
			>;
			/** Who each field that merged on its own was taken from. */
			from: Partial<Record<MergedField, 'phone' | 'server'>>;
			/** Who last changed it on the server, and when. */
			by: string | null;
			at: string | null;
	  }
	| { what: 'removed'; by: string | null; at: string }
	| { what: 'changed'; by: string | null; at: string | null };
