<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import LineForm from '#lib/LineForm.svelte';
	import Top from '#lib/Top.svelte';
	import { findDraft, type QueuedDraft } from '#lib/queue.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// The draft is this phone's: read from the queue, not loaded.
	let draft = $state<QueuedDraft | null | undefined>(undefined);
	const uuid = $derived(page.url.searchParams.get('draft') ?? '');
	onMount(() => {
		void findDraft(uuid).then(
			(d) => (draft = d ?? null),
			() => (draft = null)
		);
	});
	const back = $derived(
		`${resolve('/invoices/on-phone')}?draft=${encodeURIComponent(uuid)}` as const
	);
</script>

{#if draft}
	<LineForm
		data={{
			...data,
			draft: { id: draft.draft.client_uuid, number: null, who: draft.draft.who },
			sites: data.sites.filter((s) => s.entity_id === draft?.draft.entity_id)
		}}
		{back}
	/>
{:else if draft === null}
	<Top title="Add a line" back={resolve('/invoices')} backLabel="Invoices" />
	<div class="pad">
		<p class="why">That draft is not on this phone. It may have reached the server already.</p>
	</div>
{/if}
