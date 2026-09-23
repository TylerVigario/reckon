<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { dated } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
</script>

<Top
	title="People and pay"
	sub="Who works here, and what an hour pays"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>People</h2></div>
		<div class="rows">
			{#each data.people as p (p.id)}
				<div class="rec" class:gone={!p.active}>
					<div class="rec-m">
						<div class="rec-t">{p.name}</div>
						<div class="rec-s">
							{p.email} · {p.on_team ? 'paid for work' : 'signs in, is not paid for work'}
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v">{money(p.rate)}</span>
						{#if p.rate}<span class="rec-x">/hr</span>{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>How an hour is paid</h2></div>
		<div class="rows">
			{#each data.rates as r (r.id)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">{r.who ?? 'Everyone'}</div>
						<div class="rec-s">
							{r.service ?? 'any service'} · since {dated(r.effective_from)}
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v">{money(r.rate)}</span><span class="rec-x">/hr</span>
					</div>
				</div>
			{:else}
				<div class="rec warn">
					<div class="rec-m">
						<div class="rec-t">Nothing recorded</div>
						<div class="rec-s">Without a rate, no partner pay can be worked out</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">—</span></div>
				</div>
			{/each}
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">
						<span class="lt">A rate for one person beats a rate for everyone</span>
					</div>
					<div class="rec-s">
						And a rate for one service beats a rate for any. Both partners sit on one row today; the
						day that stops being true is one more row, not a rebuild.
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
