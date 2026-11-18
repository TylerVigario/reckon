<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { localeName } from '#lib/locales.ts';
	import { zoneName } from '#lib/format.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { SETTINGS_GROUPS, type SettingsPage } from '#lib/settings-pages.ts';
	import { stateName } from '#lib/us-states.ts';

	/**
	 * Settings on a phone: its screens in their groups, as Primer's NavList
	 * groups a settings menu, each with what it is set to now beside its name,
	 * as Android's own settings show a setting's status -- the specific detail,
	 * not a description of the screen, which each says at its own head.
	 */
	let { data }: PageProps = $props();
	const o = $derived(data.operator);

	const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
	const FILED: Record<string, string> = {
		annual: 'filed yearly',
		quarterly: 'filed quarterly',
		monthly: 'filed monthly'
	};
	const COSTED: Record<string, string> = {
		average: 'stock at its average cost',
		oldest_first: 'stock oldest first'
	};
	const units = $derived(data.counts.units);
	const status = $derived<Record<SettingsPage['route'], string>>({
		'/settings/business': o?.trading_name ?? 'Not named yet',
		'/settings/brand': [o?.has_logo ? 'A mark' : 'No mark', o?.accent_colour ?? null]
			.filter(Boolean)
			.join(' · '),
		'/settings/region': [
			localeName(o?.locale ?? 'en-US'),
			o?.currency ?? 'USD',
			zoneName(o?.timezone ?? 'UTC')
		].join(' · '),
		'/settings/invoicing': `Net ${o?.default_terms_days ?? 30} · numbered ${o?.invoice_number_format ?? 'INV-0000'}`,
		'/settings/pricing': [
			`${Number(o?.default_markup_pct ?? 25)}% markup`,
			COSTED[o?.stock_costing ?? 'average']
		].join(' · '),
		'/settings/tax': data.collects.length
			? data.collects
					.map((r) => [stateName(r.state), r.filing_basis ? FILED[r.filing_basis] : null])
					.map((parts) => parts.filter(Boolean).join(', '))
					.join(' · ')
			: 'No tax collected',
		'/settings/travel': data.counts.mileage
			? `${unitPrice(data.counts.mileage)} a mile`
			: 'No mileage rate yet',
		'/settings/vehicles': data.counts.vehicles
			? count(data.counts.vehicles, 'vehicle')
			: 'None yet',
		'/settings/units':
			units.length > 4 ? count(units.length, 'unit') : units.join(', ') || 'None yet',
		'/settings/integrations': data.counts.integrations
			? `${data.counts.integrations} connected`
			: 'None connected'
	});
</script>

<Top
	title="Settings"
	sub="Everything the operator supplies"
	back={resolve('/more')}
	backLabel="More"
/>

<nav class="pad" aria-label="Settings">
	{#each SETTINGS_GROUPS as g (g.title)}
		<div class="navlist-g">
			<h2 class="navlist-h">{g.title}</h2>
			<ul class="navlist">
				{#each g.pages as p (p.route)}
					<li>
						<a href={resolve(p.route)}>
							<span class="navlist-t">{p.title}</span>
							<span class="navlist-d">{status[p.route]}</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</nav>

<style>
	nav {
		gap: 0;
	}
</style>
