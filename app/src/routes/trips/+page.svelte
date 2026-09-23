<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { day } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const miles = (v: string) => `${Number(v).toFixed(1)} mi`;

	// Built here rather than in the markup: an {#if} inside a sentence eats the
	// space in front of its separator, which read as "Tyler Vigario· Bravo".
	const detail = (t: { travelled_on: string; driver: string | null; clients: string | null }) =>
		[day(t.travelled_on), t.driver ?? 'unassigned', t.clients].filter(Boolean).join(' · ');

	const title = (t: { stops: string | null; stop_count: number }) =>
		[t.stops ?? 'No stops recorded', t.stop_count > 1 ? `${t.stop_count} stops` : null]
			.filter(Boolean)
			.join(' · ');

	const sub = $derived(
		[
			data.totals?.month,
			`${data.totals?.trips ?? 0} ${Number(data.totals?.trips) === 1 ? 'trip' : 'trips'}`,
			miles(data.totals?.miles ?? '0')
		].join(' · ')
	);
</script>

<Top title="Trips" {sub}>
	{#snippet actions()}
		<span class="btn sm">New</span>
	{/snippet}
</Top>

<div class="pad">
	{#each [{ key: 'unbilled', head: 'Unbilled', rows: data.unbilled }, { key: 'billed', head: 'Billed', rows: data.billed }] as group (group.key)}
		{#if group.rows.length}
			<div class="sec">
				<div class="sec-h">
					<h2>{group.head}</h2>
					{#if group.key === 'unbilled' && data.totals?.rate}
						<span class="sp"></span>
						<span class="chip">Federal rate {money(data.totals.rate)}/mi</span>
					{/if}
				</div>
				<div class="rows">
					{#each group.rows as t (t.id)}
						<a class="rec link" href={resolve('/trips/[id]', { id: t.id })}>
							<div class="rec-m">
								<div class="rec-t">{title(t)}</div>
								<div class="rec-s">
									{detail(t)}
									{#if t.legs > 1}<br />One drive, {t.legs} legs{/if}
								</div>
								{#if t.legs > 1}
									<div class="rec-c">
										{#if t.balanced}
											<span class="chip good"><span class="dot"></span>Legs balanced</span>
										{:else}
											<span class="chip crit"><span class="dot"></span>More billed than driven</span
											>
										{/if}
									</div>
								{/if}
							</div>
							<div class="rec-n">
								<span class="rec-v">{money(t.value)}</span>
								<span class="rec-x">{miles(t.miles)}</span>
							</div>
							<span class="arw" aria-hidden="true">›</span>
						</a>
					{/each}
				</div>
			</div>
		{/if}
	{/each}

	{#if data.unbilled.length === 0 && data.billed.length === 0}
		<p class="none">No trips this month.</p>
	{/if}
</div>
