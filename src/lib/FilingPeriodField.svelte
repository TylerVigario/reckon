<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { periodKey, periodSaid, type FilingPeriod } from '#lib/filing-periods.ts';

	/**
	 * The period a return or a payment is for (#lib/filing-periods): one of the
	 * state's latest, as often as the business files there, or other days --
	 * the only way where it has not said how often.
	 */
	let {
		id,
		periods,
		start = $bindable(),
		end = $bindable(),
		errors,
		caption
	}: {
		id: string;
		periods: readonly FilingPeriod[];
		start: string;
		end: string;
		errors: Record<string, string>;
		/** What to say of the period chosen. */
		caption?: Snippet;
	} = $props();

	let chosen = $state(
		untrack(() =>
			periods.some((p) => p.start === start && p.end === end)
				? periodKey({ start, end })
				: periods.length
					? periodKey(periods[0])
					: 'other'
		)
	);
	function choose() {
		const p = periods.find((x) => periodKey(x) === chosen);
		if (p) [start, end] = [p.start, p.end];
	}
	const other = $derived(chosen === 'other');
	const wrong = $derived(errors.period_start ?? errors.period_end ?? '');
</script>

{#if periods.length}
	<div class="fc">
		<label class="fc-l" for="{id}-period">Period<span aria-hidden="true"> *</span></label>
		<select
			id="{id}-period"
			class="ti"
			bind:value={chosen}
			onchange={choose}
			aria-invalid={wrong && !other ? 'true' : undefined}
			aria-describedby="{id}-period-{wrong && !other ? 'e' : 'c'}"
		>
			{#each periods as p (periodKey(p))}<option value={periodKey(p)}>{periodSaid(p)}</option
				>{/each}
			<option value="other">Other days</option>
		</select>
		{#if wrong && !other}
			<p class="fc-e" id="{id}-period-e"><Octicon name="alert" />{wrong}</p>
		{:else if caption && !other}
			<p class="fc-c" id="{id}-period-c">{@render caption()}</p>
		{/if}
	</div>
{/if}
{#if other}
	<div class="days">
		<div class="fc">
			<label class="fc-l" for="{id}-start">From<span aria-hidden="true"> *</span></label>
			<input
				id="{id}-start"
				class="ti"
				type="date"
				bind:value={start}
				aria-invalid={errors.period_start ? 'true' : undefined}
				aria-describedby={errors.period_start ? `${id}-start-e` : undefined}
			/>
			{#if errors.period_start}
				<p class="fc-e" id="{id}-start-e"><Octicon name="alert" />{errors.period_start}</p>
			{/if}
		</div>
		<div class="fc">
			<label class="fc-l" for="{id}-end">To<span aria-hidden="true"> *</span></label>
			<input
				id="{id}-end"
				class="ti"
				type="date"
				bind:value={end}
				aria-invalid={errors.period_end ? 'true' : undefined}
				aria-describedby={errors.period_end ? `${id}-end-e` : `${id}-end-c`}
			/>
			{#if errors.period_end}
				<p class="fc-e" id="{id}-end-e"><Octicon name="alert" />{errors.period_end}</p>
			{:else}
				<p class="fc-c" id="{id}-end-c">
					{periods.length
						? 'The first and last day of the period, as the return gives them.'
						: 'The first and last day of the period, as the return gives them. Say how often the business files there, on Settings → Tax, to choose one.'}
				</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	.fc {
		max-width: 440px;
	}
	.days {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
</style>
