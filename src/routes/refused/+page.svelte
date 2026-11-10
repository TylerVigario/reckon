<script lang="ts">
	import { page } from '$app/state';
	import Top from '#lib/Top.svelte';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Where hooks.server.ts turns away a screen someone's access does not reach
	// (#lib/access). Nothing of that screen was read to get here.
	const field = $derived(page.data.user?.access === 'field');
</script>

<Top title="Needs Full access" />

<div class="pad">
	<div class="rows">
		<div class="rec">
			<div class="rec-m">
				{#if field}
					<div class="rec-t">You have Field access</div>
					<div class="rec-s">
						That reaches your own time and trips, team work you were on, drafts to add lines to, and
						your own pay. To have your access changed, contact {data.contact}.
					</div>
				{:else}
					<div class="rec-t">You have Full access</div>
					<div class="rec-s">Every screen is open to you.</div>
				{/if}
			</div>
		</div>
	</div>

	<div class="btnrow">
		<a class="btn pri" href={resolve('/')}>Today</a>
		<a class="btn" href={resolve('/timesheet')}>Your time</a>
	</div>
</div>
