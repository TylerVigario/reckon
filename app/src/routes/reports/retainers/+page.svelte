<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const hours = (v: string | null) => (v === null ? '—' : `${Number(v).toFixed(2)} h`);

	const basis = (m: { allotment: string; cap_hours: string | null }) =>
		m.allotment === 'unlimited'
			? 'unlimited'
			: m.allotment === 'capped'
				? `${hours(m.cap_hours)} included`
				: 'no allotment';
</script>

<Top
	title="Retainer meter"
	sub="{data.month.label} · what each retainer covered"
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
						{#each r.services as m (m.service)}
							<div class="rec-s">
								{m.service} · {basis(m)} · {hours(m.hours_used)} used{#if m.hours_left !== null}
									· {hours(m.hours_left)} left{/if}
							</div>
						{:else}
							<div class="rec-s">The agreement names no service to meter</div>
						{/each}
						{#if r.services.some((m) => m.allotment === 'unlimited')}
							<div class="rec-c"><span class="chip acc">∞</span></div>
						{/if}
					</div>
					<div class="rec-n">
						<span class="rec-v" class:mut={Number(r.charged) === 0}>{money(r.charged)}</span>
						<span class="rec-x">
							{#if Number(r.paid) > 0}
								{money(r.paid)} paid out
							{:else}
								all kept
							{/if}
						</span>
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing to meter</span></div>
						<div class="rec-s">
							No retainer ran in {data.month.label} and no hour was worked on a service sold as a subscription
						</div>
					</div>
				</div>
			{/each}
			{#if data.rows.length}
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Retainers</div></div>
					<div class="rec-n">
						<span class="rec-v">{money(data.charged)}</span>
						<span class="rec-x">{money(data.kept)} kept</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
