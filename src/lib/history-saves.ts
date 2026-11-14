/**
 * HISTORY READ AS SAVES: record_history keeps a row for each field a save
 * changed, so a person's reading of it is one event to each save -- the rows
 * of one transaction (xact), or, before history kept that, of one moment and
 * one person. Oldest first; each record's own history says what an event is.
 */
type Row = { changed_by: string | null; changed_at: string; xact: number | null };

export function inSaves<R extends Row, E>(
	rows: readonly R[],
	begin: (r: R) => E,
	take: (e: E, r: R) => void
): E[] {
	const events: E[] = [];
	const bySave = new Map<string, E>();
	for (const r of [...rows].sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at))) {
		const key = r.xact !== null ? `x${r.xact}` : `t${r.changed_at}|${r.changed_by ?? ''}`;
		let e = bySave.get(key);
		if (!e) {
			e = begin(r);
			bySave.set(key, e);
			events.push(e);
		}
		take(e, r);
	}
	return events;
}

/** A row's whole record, as an added or removed row keeps it. */
export const whole = (v: string | null): Record<string, unknown> => {
	try {
		const parsed: unknown = JSON.parse(v ?? '{}');
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};
