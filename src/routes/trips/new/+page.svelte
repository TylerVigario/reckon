<script lang="ts">
	import TripForm from '#lib/trip/TripForm.svelte';
	import { findTrip, servicesHeld, type QueuedTrip, type ServiceEntry } from '#lib/queue.ts';
	import { servicesAdded } from '#lib/services-held.ts';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	// ?fix= is a trip waiting on this phone, refused or not yet sent: it opens
	// as it was filled in, to be put right and saved again in its place.
	const fixing = page.url.searchParams.get('fix');
	let held = $state<QueuedTrip | null>(null);
	let found = $state(!fixing);
	// A service charged by the mile, added on this phone and not yet sent, can
	// bill a trip at once (#lib/services-held); the trip waits for it.
	let added = $state<ServiceEntry[] | null>(null);
	onMount(() => {
		void servicesHeld().then(
			(rows) => (added = rows.filter((q) => !q.refused).map((q) => q.service)),
			() => (added = [])
		);
		if (!fixing) return;
		void findTrip(fixing)
			.then((q) => (held = q ?? null))
			.catch(() => {})
			.finally(() => (found = true));
	});
	const choices = $derived({
		...data,
		services: servicesAdded(
			data.services,
			added ?? [],
			(s) => ({ id: s.client_uuid, name: s.fields.name }),
			(s) => s.fields.unit === 'mile'
		)
	});
</script>

{#if found}
	<!-- Drawn again with any service waiting on this phone among its choices. -->
	{#key added?.length ?? 0}
		<TripForm data={choices} start={held?.trip.draft ?? null} tripId={held?.trip.trip_id ?? null} />
	{/key}
{/if}
