<script lang="ts">
	import SecurityLog from '#lib/SecurityLog.svelte';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/** Your own security log (+page.server.ts), a year of it. */
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Security log</title></svelte:head>

<div class="primer log">
	<p class="lede">
		Every sign-in to your account, refused or not, every passkey and link, and every change to what
		you can reach, for a year. Anything here you don’t recognise, tell whoever runs reckon.
	</p>
	<SecurityLog
		events={data.events}
		older={data.older
			? resolve(`/profile/security-log?before=${encodeURIComponent(data.older)}`)
			: null}
		person={data.user?.id ?? null}
		empty="Nothing yet."
	/>
</div>

<style>
	.log {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
</style>
