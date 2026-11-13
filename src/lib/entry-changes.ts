import {
	discardTimeChange,
	enqueue,
	flush,
	timeChangesHeld,
	type QueuedTimeChange,
	type ShownEntry
} from './queue.ts';

/**
 * What this phone has for the time entries a list shows: a change waiting to
 * send, or one that ran into something (#lib/queue). Time and All entries show
 * an entry as it is once changed here, and say so, since the server cannot
 * know it yet.
 */
export async function changesByEntry(): Promise<Map<string, QueuedTimeChange>> {
	try {
		return new Map((await timeChangesHeld()).map((q) => [q.change.entry_id, q]));
	} catch {
		return new Map();
	}
}

/** An entry as a list shows it: the server's, or as this phone changed it. */
export const asChanged = <E extends object>(e: E, q: QueuedTimeChange | undefined): E =>
	q ? { ...e, ...(q.change.shown satisfies ShownEntry) } : e;

/** What a list says of an entry's change, and how loudly. */
export function markOf(q: QueuedTimeChange): { tone: 'acc' | 'warn' | 'crit'; text: string } {
	const c = q.refused?.conflict;
	if (c?.what === 'collided') return { tone: 'warn', text: 'Changed in two places' };
	if (c?.what === 'removed') return { tone: 'warn', text: 'Removed meanwhile' };
	if (c?.what === 'changed') return { tone: 'warn', text: 'Changed since you removed it' };
	if (q.refused) return { tone: 'crit', text: 'Change refused' };
	return q.change.act === 'remove'
		? { tone: 'acc', text: 'Removed on this phone' }
		: { tone: 'acc', text: 'Changed on this phone' };
}

/**
 * An entry removed meanwhile, added again as a new one with the change made to
 * it on this phone; the change then goes. `fields` is a plain copy, which the
 * phone's database stores where a $state proxy it cannot. Rejects, leaving the
 * change where it is, if the phone would not keep the entry.
 */
export async function addAgain(
	q: QueuedTimeChange,
	fields: QueuedTimeChange['change']['fields'],
	me: string
) {
	await enqueue({ ...fields, client_uuid: crypto.randomUUID(), created_by: me });
	await discardTimeChange(q.change.entry_id).catch(() => {});
	await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
}
