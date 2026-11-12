<script lang="ts">
	import SecurityLog from '#lib/SecurityLog.svelte';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import type { PageProps } from './$types';

	/** One person's security log (+page.server.ts), a year of it. */
	let { data }: PageProps = $props();

	// Their page's own address, with the cursor the loader gave for the next.
	const older = $derived(
		data.older
			? (`${resolve('/team/[id]/security-log', { id: data.person.id })}?before=${encodeURIComponent(data.older)}` as ResolvedPathname)
			: null
	);
</script>

<svelte:head><title>Security log · {data.person.name}</title></svelte:head>

<SecurityLog events={data.events} {older} person={data.person.id} empty="Nothing yet." />
