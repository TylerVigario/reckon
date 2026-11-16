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

<!-- Primer's Blankslate: why the screen isn't here, and the one place to go. -->
<div class="pad primer">
	<section class="box" aria-labelledby="refused-h">
		<div class="blank">
			{#if field}
				<h2 class="blank-h" id="refused-h">You have Field access</h2>
				<p class="blank-d">
					That reaches your own time and trips, team work you were on, drafts to add lines to, and
					your own pay. To have your access changed, contact {data.contact}.
				</p>
				<a class="btn pri" href={resolve('/')}>Today</a>
				<a class="lk" href={resolve('/timesheet')}>Your time</a>
			{:else}
				<h2 class="blank-h" id="refused-h">You have Full access</h2>
				<p class="blank-d">Every screen is open to you.</p>
				<a class="btn pri" href={resolve('/')}>Today</a>
			{/if}
		</div>
	</section>
</div>
