<script lang="ts">
	import Top from '$lib/Top.svelte';
	import Setting from '$lib/Setting.svelte';
	import { money } from '$lib/money.svelte';
	import Day from '$lib/Day.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	const o = $derived(data.operator);
</script>

<Top
	title="Travel"
	sub="Where trips start and what a mile costs"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>Base</h2></div>
		<div class="rows">
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">Trips start and end here</div>
					<div class="rec-s">
						{o?.address ?? 'No address set'} — every distance is measured from it. Change it and the round
						trips change with it; the miles already billed do not.
					</div>
				</div>
				<div class="rec-n">
					<a class="btn sm" href={resolve('/settings/business')}>Edit</a>
				</div>
			</div>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Rate</h2></div>
		<div class="rows">
			{#each data.rates as r (r.id)}
				<div class="rec" class:acc={r.state === 'scheduled'}>
					<div class="rec-m">
						<div class="rec-t">{r.state === 'scheduled' ? 'Scheduled' : 'Current'}</div>
						<div class="rec-s">
							{r.service} · {r.state === 'scheduled' ? 'takes over' : 'effective'}
							<Day iso={r.effective_from} />
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v">{money(r.rate)}</span><span class="rec-x">/mi</span>
					</div>
				</div>
			{:else}
				<div class="rec warn">
					<div class="rec-m">
						<div class="rec-t">Not priced</div>
						<div class="rec-s">Mileage is a service; give it a dated price to bill any</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">—</span></div>
				</div>
			{/each}
			{#each data.history as h (h.id)}
				<a class="rec link" href={resolve('/services/[id]/history', { id: h.id })}>
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Earlier rates</span></div>
						<div class="rec-s">
							{h.name} · {h.earlier} no longer in force, still priced on every line billed under them
						</div>
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{/each}
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>How legs are assigned</h2></div>
		<div class="rows inset">
			<Setting
				name="mileage_assignment"
				label="Rule"
				value={o?.mileage_assignment ?? 'actual'}
				options={[
					{ value: 'actual', label: 'Assign each leg to whoever caused it' },
					{ value: 'round_trip_per_client', label: 'A full round trip per client' }
				]}
				hint="Never bill more miles than were driven"
			/>
		</div>
	</div>
</div>

<style>
</style>
