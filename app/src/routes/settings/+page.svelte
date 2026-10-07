<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { unitPrice } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import type { RouteId } from '$app/types';

	let { data }: PageProps = $props();
	const o = $derived(data.operator);

	// What each screen is set to now, under its name, as Android's own settings
	// show a setting's status: the specific detail, not a description of the
	// screen -- each screen says what it is for at its own head.
	const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
	const TAX: Record<string, string> = {
		us_ca: "California's rules",
		flat_per_site: 'A flat rate for each site',
		none: 'No tax charged'
	};
	const FILED: Record<string, string> = {
		annual: 'filed yearly',
		quarterly: 'filed quarterly',
		monthly: 'filed monthly'
	};
	const units = $derived(data.counts.units);
	const pages = $derived([
		{
			href: '/settings/business',
			title: 'Business',
			status: o?.trading_name ?? 'Not named yet'
		},
		{
			href: '/settings/invoicing',
			title: 'Invoicing',
			status: `Net ${o?.default_terms_days ?? 30} · numbered ${o?.invoice_number_format ?? 'INV-0000'}`
		},
		{
			href: '/settings/tax',
			title: 'Tax',
			status: [
				TAX[o?.tax_rule_set ?? 'none'] ?? o?.tax_rule_set,
				o?.tax_rule_set === 'us_ca' && o.filing_basis ? FILED[o.filing_basis] : null
			]
				.filter(Boolean)
				.join(' · ')
		},
		{
			href: '/settings/people',
			title: 'People and pay',
			status: count(data.counts.people, 'person', 'people')
		},
		{
			href: '/settings/travel',
			title: 'Travel',
			status: [
				data.counts.mileage ? `${unitPrice(data.counts.mileage)} a mile` : 'No mileage rate yet',
				data.counts.vehicles ? count(data.counts.vehicles, 'vehicle') : null
			]
				.filter(Boolean)
				.join(' · ')
		},
		{
			href: '/settings/units',
			title: 'Units',
			status: units.length > 4 ? count(units.length, 'unit') : units.join(', ') || 'None yet'
		},
		{
			href: '/settings/integrations',
			title: 'Integrations',
			status: data.counts.integrations ? `${data.counts.integrations} connected` : 'None connected'
		}
	] satisfies { href: RouteId; title: string; status: string }[]);
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
						<div class="rec-s status">{p.status}</div>
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{/each}
		</div>
	</div>
</div>

<style>
	/* What it is set to: the thing worth reading, so a shade stronger than a description. */
	.status {
		color: var(--ink-2);
	}
</style>
