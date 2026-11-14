<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Detail from '#lib/Detail.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import Day from '#lib/Day.svelte';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { parseField } from '#lib/settings-fields.ts';
	import type { PageProps } from './$types';

	/**
	 * Where trips start and end -- the business's address, changed on Business
	 * -- what a mile is charged at, the mileage service's dated price, and how a
	 * trip's legs are put to the clients they were driven for, changed in place
	 * (#lib/Detail).
	 */
	let { data }: PageProps = $props();
	const o = $derived(data.operator);
</script>

<Top
	title="Travel"
	sub="Where trips start, and what a mile is charged at"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad primer">
	<section class="box" aria-labelledby="base-h">
		<div class="box-h"><h2 class="box-t" id="base-h">Base</h2></div>
		<div class="box-row kv">
			<span class="kv-l">Trips start and end at</span>
			<span class="kv-v">
				<span
					>{#if o?.address}{o.address}{:else}<span class="muted">No address yet</span>{/if}</span
				>
				<span class="kv-s">The business’s address</span>
			</span>
			<span class="kv-end">
				<a class="ib" href={resolve('/settings/business')} aria-label="Change it on Business"
					><Octicon name="pencil" /></a
				>
			</span>
		</div>
	</section>

	<section class="box" aria-labelledby="rate-h">
		<div class="box-h"><h2 class="box-t" id="rate-h">Rate</h2></div>
		{#each data.rates as r (r.id)}
			<div class="box-row line">
				<span class="what">
					<span class="n">{r.state === 'scheduled' ? 'Scheduled' : 'Current'}</span>
					<span class="sub"
						>{r.service} · {r.state === 'scheduled' ? 'takes over' : 'from'}
						<Day iso={r.effective_from} /></span
					>
				</span>
				{#if r.state === 'scheduled'}<span class="lab acc">Scheduled</span>{/if}
				<span class="fig"
					><span class="v">{unitPrice(r.rate)}</span><span class="sub">a mile</span></span
				>
			</div>
		{:else}
			<div class="box-row line">
				<span class="what">
					<span class="n">Not priced</span>
					<span class="sub">Mileage is a service: give it a dated price to bill any.</span>
				</span>
				<span class="lab warn">No rate</span>
			</div>
		{/each}
		{#each data.history as h (h.id)}
			<a class="box-row line" href={resolve('/catalogue/services/[id]/history', { id: h.id })}>
				<span class="what">
					<span class="n">Earlier rates</span>
					<span class="sub"
						>{h.name} · {h.earlier} no longer in force, still priced on every line billed under them</span
					>
				</span>
			</a>
		{/each}
	</section>

	<section class="box" aria-labelledby="legs-h">
		<div class="box-h"><h2 class="box-t" id="legs-h">Legs</h2></div>
		<Detail
			name="mileage_assignment"
			label="Each leg"
			value={o?.mileage_assignment ?? 'actual'}
			options={[
				{ value: 'actual', label: 'Goes to whoever caused it' },
				{ value: 'round_trip_per_client', label: 'A full round trip for each client' }
			]}
			endpoint="/api/settings"
			validate={parseField}
			onsaved={() => refreshAll()}
		>
			{#snippet caption()}Never more miles are billed than were driven.{/snippet}
		</Detail>
	</section>
</div>

<style>
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		box-sizing: border-box;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.lab {
		flex: 0 0 auto;
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}
	.v {
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
</style>
