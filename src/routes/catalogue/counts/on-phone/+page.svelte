<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import CountSheet from '#lib/CountSheet.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { dated } from '#lib/format.ts';
	import { findCount, type QueuedCount } from '#lib/queue.ts';
	import type { PageProps } from './$types';

	/**
	 * A count started on this phone with no signal, counted here until it
	 * arrives (#lib/CountSheet). It joins whichever count is open when it does,
	 * and is applied from there.
	 */
	let { data }: PageProps = $props();
	const uuid = $derived(page.url.searchParams.get('count') ?? '');
	let count = $state<QueuedCount | null | undefined>(undefined);
	let waiting = $state(0);
	onMount(() => {
		void findCount(uuid).then(
			(q) => (count = q ?? null),
			() => (count = null)
		);
	});
</script>

<Top
	title="Count"
	sub={count ? `${dated(count.count.counted_on)} · started on this phone` : undefined}
	back={resolve('/catalogue/materials')}
	backLabel="Materials"
/>

<div class="pad primer">
	<OfflineBanner asOf={data.as_of} {waiting} />
	{#if count}
		<p class="note">
			Waiting to send. It joins the count that is open when it arrives, and is applied from there.
		</p>
		<CountSheet count={uuid} sheet={data.sheet} lines={[]} onwaiting={(n) => (waiting = n)} />
	{:else if count === null}
		<p class="box-row muted">
			That count is not on this phone. It has reached the server: Materials opens the count it
			joined.
		</p>
	{/if}
</div>
