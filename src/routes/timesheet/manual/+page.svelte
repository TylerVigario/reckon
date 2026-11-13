<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Top from '#lib/Top.svelte';
	import EntryForm from '#lib/EntryForm.svelte';
	import type { EntryFields, EntrySeed } from '#lib/entry-form.ts';
	import { enqueue, find, flush, secondsOf, type Queued } from '#lib/queue.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * Add past work: an entry for work already finished, entered by hand
	 * (#lib/EntryForm), written down on the phone first and sent when there is a
	 * connection (#lib/queue).
	 *
	 * FIXING an entry the server refused: the same form, filled in from the copy
	 * the phone kept, saved back under the same client_uuid -- which replaces
	 * the refused copy rather than adding a second entry. Whatever the server
	 * named as gone is left empty to be chosen again.
	 */
	let { data }: PageProps = $props();
	const field = untrack(() => data.user?.access === 'field');

	let fixing = $state<Queued | null>(null);
	onMount(async () => {
		const id = page.url.searchParams.get('fix');
		const q = id ? await find(id).catch(() => undefined) : undefined;
		if (q?.refused) fixing = q;
	});
	const seed = $derived<EntrySeed | null>(
		fixing
			? {
					...fixing.entry,
					seconds: secondsOf(fixing.entry),
					worked_by: fixing.entry.worked_by,
					entity_id: fixing.entry.entity_id ?? null,
					site_id: fixing.entry.site_id ?? null,
					billable: fixing.entry.billable ?? true,
					note: fixing.entry.note ?? null
				}
			: null
	);

	// Written down locally first, always. The connection decides when it reaches
	// the server, not whether the work was recorded.
	async function save(entry: EntryFields) {
		try {
			await enqueue({
				...entry,
				client_uuid: fixing?.entry.client_uuid ?? crypto.randomUUID(),
				created_by: data.me
			});
		} catch {
			return 'This phone would not save it. Nothing was recorded; try again.';
		}
		await flush().catch(() => {});
		await goto(resolve('/timesheet'));
		return null;
	}
</script>

<Top
	title={fixing ? 'Fix an entry' : 'Add past work'}
	sub={fixing
		? 'Refused by the server, kept on this phone'
		: 'Work already finished, entered by hand'}
	back={resolve('/timesheet')}
	backLabel="Time"
/>

<div class="pad">
	{#key fixing?.entry.client_uuid}
		<EntryForm
			choices={data}
			{field}
			{seed}
			saveLabel={fixing ? 'Save and send again' : 'Save entry'}
			onsave={save}
		>
			{#snippet above()}
				{#if fixing?.refused}<p class="why bad">Refused: {fixing.refused.detail}</p>{/if}
			{/snippet}
			{#snippet below()}
				<p class="aside">
					Still working? <a href={resolve('/timesheet/start')}>Start a timer</a> instead and it will fill
					this in for you.
				</p>
			{/snippet}
		</EntryForm>
	{/key}
</div>

<style>
	.why.bad {
		border-left-color: var(--crit);
		color: var(--crit);
	}
	.aside {
		margin: 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
</style>
