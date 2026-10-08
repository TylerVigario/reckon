<script lang="ts">
	import TripForm from '#lib/trip/TripForm.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<TripForm {data} start={data.draft} tripId={data.id} />
