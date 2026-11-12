<script lang="ts">
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import SecurityLog from '#lib/SecurityLog.svelte';
	import { teamTabs } from '#lib/section-tabs.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/** Everyone's security log (+page.server.ts), a year of it. */
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Security log · Team</title></svelte:head>

<Top title="Team" back={resolve('/more')} backLabel="More" />

<div class="pad primer log">
	<UnderlineNav
		label="Team"
		items={teamTabs('security-log', { people: data.people, roles: data.roles })}
	/>
	<p class="lede">
		Everyone’s sign-ins, refused or not, their passkeys and links, and every change to who can reach
		what, for a year.
	</p>
	<SecurityLog
		events={data.events}
		older={data.older
			? resolve(`/team/security-log?before=${encodeURIComponent(data.older)}`)
			: null}
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
