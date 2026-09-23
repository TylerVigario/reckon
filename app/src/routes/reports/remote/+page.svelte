<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const hours = (v: string | null) => (v === null ? '—' : `${Number(v).toFixed(2)} h`);

	const basis = (r: { allotment: string; cap_hours: string | null }) =>
		r.allotment === 'unlimited'
			? 'unlimited'
			: r.allotment === 'capped'
				? `${Number(r.cap_hours ?? 0).toFixed(2)} h included`
				: 'no allotment';
</script>

<Top
	title="Remote meter"
	sub="{data.month.label} · what the retainer covered"
	back={resolve('/reports')}
	backLabel="Reports"
/>

<div class="pad">
	<div class="sec">
		<div class="rows">
			{#each data.rows as r (r.entity_id)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">{r.client}</div>
						<div class="rec-s">{basis(r)} · {hours(r.hours_used)} used</div>
						{#if r.allotment === 'unlimited'}
							<div class="rec-c"><span class="chip acc">∞</span></div>
						{/if}
					</div>
					<div class="rec-n">
						<span class="rec-v" class:mut={Number(r.charged) === 0}>{money(r.charged)}</span>
						<span class="rec-x">
							{#if Number(r.to_responder) > 0}
								{money(r.to_responder)} to responder
							{:else if r.hours_left !== null}
								{hours(r.hours_left)} left
							{:else}
								all to the partnership
							{/if}
						</span>
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing to meter</span></div>
						<div class="rec-s">
							No retainer ran in {data.month.label} and no remote hour was worked
						</div>
					</div>
				</div>
			{/each}
			{#if data.rows.length}
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Remote support</div></div>
					<div class="rec-n">
						<span class="rec-v">{money(data.charged)}</span>
						<span class="rec-x">{money(data.toOperator)} to the partnership</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
