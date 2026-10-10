<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import Setting from '#lib/Setting.svelte';
	import { parsePersonField } from '#lib/people-fields.ts';
	import { weekdayName, zoneName } from '#lib/format.ts';
	import { zoneOptions } from '#lib/zone-options.ts';
	import { localeName, localeOptions, pickLocale, weekStartOf } from '#lib/locales.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const me = $derived(data.me);
	const endpoint = $derived(`/api/people/${data.user?.id}`);
	// What follows from the locale while the person has not chosen otherwise.
	const locale = $derived(me.locale ?? data.businessLocale);
	const localeWeek = $derived(weekStartOf(locale));

	// Every figure on every page reads in these, so a change redraws them all.
	const redraw = () => invalidateAll();

	const clocks = [
		{ value: '', label: 'As the locale has it' },
		{ value: 'h12', label: '12-hour, as in 2:05 PM' },
		{ value: 'h23', label: '24-hour, as in 14:05' }
	];
	const weeks = $derived([
		{ value: '', label: `As the locale has it — ${weekdayName(localeWeek)}` },
		...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: weekdayName(n) }))
	]);

	// THE BROWSER AS A STARTING POINT. Somebody who has not chosen a locale is
	// offered the one their browser is set to, in one tap, when it differs from
	// the business's. It is never switched on its own: a browser's language says
	// what someone reads, not always how they want dates written.
	let browser = $state<string | null>(null);
	onMount(() => (browser = pickLocale(navigator.language ?? '')));
	const offer = $derived(
		me.locale === null && browser !== null && browser !== data.businessLocale ? browser : null
	);
	let taking = $state(false);
	async function takeBrowser() {
		if (!offer || !data.user) return;
		taking = true;
		const r = await fetch(endpoint, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { locale: offer } })
		}).catch(() => null);
		taking = false;
		if (r?.ok) await redraw();
	}
</script>

<Top title="Your profile" sub={data.user?.name ?? ''} back={resolve('/more')} backLabel="More" />

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>How dates and figures read</h2></div>
		<div class="rows inset">
			{#if offer}
				<div class="offer">
					<span>Your browser is set to {localeName(offer)}.</span>
					<button type="button" class="btn sm" disabled={taking} onclick={takeBrowser}
						>Use {localeName(offer)}</button
					>
				</div>
			{/if}
			<Setting
				name="locale"
				label="Locale"
				value={me.locale ?? ''}
				options={localeOptions(me.locale, "The business's")}
				hint={me.locale === null
					? `Following the business's: ${localeName(data.businessLocale)}. The language dates are written in, the order of day and month, and the separators in figures.`
					: 'The language dates are written in, the order of day and month, and the separators in figures.'}
				{endpoint}
				validate={parsePersonField}
				onsaved={redraw}
			/>
			<Setting
				name="hour_cycle"
				label="Time format"
				value={me.hour_cycle ?? ''}
				options={clocks}
				{endpoint}
				validate={parsePersonField}
				onsaved={redraw}
			/>
			<Setting
				name="week_start"
				label="First day of the week"
				value={me.week_start === null ? '' : String(me.week_start)}
				options={weeks}
				hint="Where All entries begins each week."
				{endpoint}
				validate={parsePersonField}
				onsaved={redraw}
			/>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Your clock</h2></div>
		<div class="rows inset">
			<Setting
				name="timezone"
				label="Time zone"
				value={me.timezone ?? ''}
				options={zoneOptions(me.timezone, `The business's — ${zoneName(data.businessZone)}`)}
				hint={me.timezone
					? 'Your own, on every device. A phone in another zone asks before changing it.'
					: 'Set from your browser when you first sign in.'}
				{endpoint}
				validate={parsePersonField}
				onsaved={redraw}
			/>
		</div>
	</div>
</div>

<style>
	.offer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		background: var(--accent-wash);
		border-bottom: 1px solid var(--line);
		font-size: 14px;
	}
</style>
