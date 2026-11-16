<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Detail from '#lib/Detail.svelte';
	import { parseField } from '#lib/settings-fields.ts';
	import { zoneOptions } from '#lib/zone-options.ts';
	import { localeOptions, ownName } from '#lib/locales.ts';
	import type { PageProps } from './$types';

	/**
	 * The business's region, each changed in place (#lib/Detail): how its dates
	 * and figures read, and each person's until they choose their own; what its
	 * money is in; and its clock, which overdue, ageing and report months
	 * follow. A change redraws every figure on every screen.
	 */
	let { data }: PageProps = $props();
	const o = $derived(data.operator);
	const locale = $derived(o?.locale ?? 'en-US');
	const zone = $derived(o?.timezone ?? 'UTC');
	const redraw = () => invalidateAll();
</script>

<Top
	title="Region"
	sub="How its dates, figures and money read, and its clock"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<section class="box" aria-label="Region">
		<Detail
			name="locale"
			label="Locale"
			value={locale}
			options={localeOptions(locale)}
			hint={ownName(locale) ?? ''}
			endpoint="/api/settings"
			validate={parseField}
			onsaved={redraw}
		>
			{#snippet caption()}
				How the business’s dates and figures read, and each person’s until they choose their own.
			{/snippet}
		</Detail>
		<Detail
			name="currency"
			label="Currency"
			value={o?.currency ?? 'USD'}
			endpoint="/api/settings"
			validate={parseField}
			onsaved={redraw}
		>
			{#snippet caption()}Its three-letter code: USD, CAD, EUR.{/snippet}
		</Detail>
		<Detail
			name="timezone"
			label="Time zone"
			value={zone}
			options={zoneOptions(zone)}
			endpoint="/api/settings"
			validate={parseField}
			onsaved={redraw}
		>
			{#snippet caption()}
				The business’s clock: overdue, ageing and report months. Each person keeps their own.
			{/snippet}
		</Detail>
	</section>
</div>
