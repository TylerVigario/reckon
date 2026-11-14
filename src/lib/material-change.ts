/**
 * A CHANGE TO A MATERIAL, kept on the phone first and sent by the queue
 * (#lib/queue), as a line's change is: with a signal it arrives at once; with
 * none it waits. What it came to, for the screen that made it: arrived,
 * waiting, or refused -- for something wrong with it, or because someone else
 * changed the same thing meanwhile, which is the person's to decide.
 */
import {
	enqueueMaterialChange,
	flush,
	materialChangeKey,
	materialChangesHeld,
	type MaterialChange,
	type MaterialConflict,
	type Refusal
} from './queue.ts';

export type Came =
	| { state: 'sent' }
	| { state: 'waiting' }
	| { state: 'refused'; refused: Refusal<MaterialConflict> };

export async function changeMaterial(c: Omit<MaterialChange, 'key'>): Promise<Came> {
	await enqueueMaterialChange(c);
	// A few seconds for the server to take it; no longer, on a weak signal.
	await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
	const key = materialChangeKey(c.kind, c.material_id);
	const left = (await materialChangesHeld(c.material_id)).find((q) => q.change.key === key);
	if (!left) return { state: 'sent' };
	return left.refused ? { state: 'refused', refused: left.refused } : { state: 'waiting' };
}
