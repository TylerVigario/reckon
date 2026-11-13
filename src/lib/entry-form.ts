// What an entry's form takes and gives (#lib/EntryForm), for the screens that
// open it: Add past work, and an entry's own.
import type { Entry } from '#lib/queue.ts';
import type { rateFor } from '#lib/rates.ts';

/**
 * What an entry's form opens filled in with: one the server refused, from the
 * phone's copy, or one the server has, to change. Its length is its seconds,
 * and its moments where it kept them.
 */
export type EntrySeed = {
	worked_on: string;
	seconds: number;
	started_at?: string | null;
	ended_at?: string | null;
	zone?: string | null;
	crew: 'one' | 'team';
	worked_by: string | null;
	crew_ids?: string[];
	entity_id: string | null;
	site_id: string | null;
	service_id: string | null;
	billable: boolean;
	note: string | null;
};

/** What the form saves: an entry, short of whose phone it is on and its uuid. */
export type EntryFields = Omit<Entry, 'client_uuid' | 'created_by'>;

/** What it offers to choose from, as Add past work loads it. */
export type EntryChoices = {
	today: string;
	me: string;
	people: { id: string; name: string }[];
	entities: {
		id: string;
		name: string;
		sites: { id: string; label: string; rate_pct: string | null }[];
	}[];
	services: { id: string; name: string; unit: string }[];
	prices: Parameters<typeof rateFor>[0];
};
