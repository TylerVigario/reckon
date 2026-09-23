<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	const n = (v: string) => Number(v);
	const c = $derived(data.counts);
</script>

<Top title="Catalogue" sub="What can go on a line" back={resolve('/more')} backLabel="More" />

<div class="pad">
	<div class="sec">
		<div class="rows">
			<a class="rec link" href={resolve('/services')}>
				<div class="rec-m">
					<div class="rec-t">Services</div>
					<div class="rec-s">On-site, remote, mileage · billed and paid rates</div>
					{#if n(c.unpriced) > 0}
						<div class="rec-c">
							<span class="chip warn">
								<span class="dot"></span>{c.unpriced} not priced
							</span>
						</div>
					{/if}
				</div>
				<div class="rec-n"><span class="rec-v mut">{c.services}</span></div>
				<span class="arw" aria-hidden="true">›</span>
			</a>

			<a class="rec link" href={resolve('/catalogue/materials')}>
				<div class="rec-m">
					<div class="rec-t">Materials</div>
					<div class="rec-s">Ex-tax cost, tax paid and stock on hand</div>
					{#if n(c.out_of_stock) > 0}
						<div class="rec-c">
							<span class="chip warn">
								<span class="dot"></span>{c.out_of_stock} out of stock
							</span>
						</div>
					{/if}
				</div>
				<div class="rec-n"><span class="rec-v mut">{c.materials}</span></div>
				<span class="arw" aria-hidden="true">›</span>
			</a>

			<a class="rec link" href={resolve('/catalogue/agreements')}>
				<div class="rec-m">
					<div class="rec-t">Recurring agreements</div>
					<div class="rec-s">Retainers, what they cover and what they meter</div>
					{#if n(c.recurring) > 0}
						<div class="rec-c"><span class="chip acc">{money(c.recurring)}/mo</span></div>
					{/if}
				</div>
				<div class="rec-n"><span class="rec-v mut">{c.agreements}</span></div>
				<span class="arw" aria-hidden="true">›</span>
			</a>
		</div>
	</div>
</div>
