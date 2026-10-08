<script lang="ts">
	import TripForm from '#lib/trip/TripForm.svelte';
	import { findTrip, type QueuedTrip } from '#lib/queue.ts';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	// ?fix= is a trip waiting on this phone, refused or not yet sent: it opens
	// as it was filled in, to be put right and saved again in its place.
	const fixing = page.url.searchParams.get('fix');
	let held = $state<QueuedTrip | null>(null);
	let ready = $state(!fixing);
	onMount(() => {
		if (!fixing) return;
		void findTrip(fixing)
			.then((q) => (held = q ?? null))
			.catch(() => {})
			.finally(() => (ready = true));
	});
</script>

{#if ready}
	<TripForm {data} start={held?.trip.draft ?? null} tripId={held?.trip.trip_id ?? null} />
{/if}
