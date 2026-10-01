<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';

	let { data }: PageProps = $props();
	const o = $derived(data.operator);

	const pages = $derived([
		{
			href: '/settings/business',
			title: 'Business',
			sub: 'Name, mark, address, tax number — what appears on an invoice',
			value: o?.short_name ?? o?.trading_name ?? 'not set'
		},
		{
			href: '/settings/invoicing',
			title: 'Invoicing',
			sub: 'Numbering, terms, delivery and what the footer says',
			value: o?.default_terms_days ? `Net ${o.default_terms_days}` : 'not set'
		},
		{
			href: '/settings/tax',
			title: 'Tax',
			sub: 'Whether it applies, which rules, and how it is filed',
			value: o?.tax_rule_set === 'us_ca' ? 'US · CA' : (o?.tax_rule_set ?? 'none')
		},
		{
			href: '/settings/people',
			title: 'People and pay',
			sub: 'Who works here, and what an hour pays them',
			value: data.counts.people
		},
		{
			href: '/settings/travel',
			title: 'Travel',
			sub: 'Where trips start, the mileage rate, how legs are assigned',
			value: data.counts.mileage ? money(data.counts.mileage) : 'not priced'
		},
		{
			href: '/settings/integrations',
			title: 'Integrations',
			sub: 'Payments, the ledger, the PDF renderer and email',
			value: data.counts.integrations
		}
	] satisfies { href: Pathname; title: string; sub: string; value: string }[]);
</script>

<Top
	title="Settings"
	sub="Everything the operator supplies"
	back={resolve('/more')}
	backLabel="More"
/>

<div class="pad">
	<div class="sec">
		<div class="rows">
			{#each pages as p (p.href)}
				<a class="rec link" href={resolve(p.href)}>
					<div class="rec-m">
						<div class="rec-t">{p.title}</div>
						<div class="rec-s">{p.sub}</div>
					</div>
					<div class="rec-n"><span class="rec-v mut">{p.value}</span></div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{/each}
		</div>
	</div>
</div>
