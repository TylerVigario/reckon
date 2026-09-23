<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { day, dated } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// The month is in the header, so a job's day does not repeat it. A rate's
	// start date can be any year, so it says which.

	const who = (j: { crew: string; who: string | null }) =>
		j.crew === 'team' ? 'Both of you' : (j.who ?? 'nobody recorded');

	const label = (crew: string) => (crew === 'team' ? 'Both of you' : 'One of you');

	// Built here rather than in the markup: a template that interleaves text
	// with {#if} blocks loses the space between them.
	const terms = (r: {
		billed: string | null;
		paid: string | null;
		crew: string;
		from: string | null;
	}) =>
		[
			`${money(r.billed)} billed`,
			`${money(r.paid)}${r.crew === 'team' ? ' a head' : ' paid'}`,
			r.from ? `since ${dated(r.from)}` : null
		]
			.filter(Boolean)
			.join(' · ');

	// A rate pair only makes sense when both halves are known: a billed rate
	// with no pay rate behind it cannot say what is kept.
	const kept = (r: { billed: string | null; paid: string | null; crew: string }) =>
		r.billed === null || r.paid === null
			? null
			: (Number(r.billed) - Number(r.paid) * (r.crew === 'team' ? 2 : 1)).toFixed(2);
</script>

<Top
	title="Partner pay"
	sub="{data.month.label} · resolved per job, per day"
	back={resolve('/reports')}
	backLabel="Reports"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>{data.month.label}</h2></div>
		<div class="rows">
			{#each data.jobs as j, i (j.job + j.worked_on + i)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">{j.job} · {day(j.worked_on)}</div>
						<div class="rec-s">
							{who(j)} · {Number(j.hours).toFixed(4)} h{#if j.crew === 'team' && j.paid}
								· {money(Number(j.paid) / 2)} each{/if}
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v">{money(j.paid)}</span>
						<span class="rec-x">kept {money(j.kept)}</span>
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing worked</span></div>
						<div class="rec-s">No billable hours were recorded in {data.month.label}</div>
					</div>
				</div>
			{/each}
			{#if data.jobs.length}
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Guaranteed payments due</div></div>
					<div class="rec-n">
						<span class="rec-v">{money(data.due)}</span>
						<span class="rec-x">kept {money(data.kept)}</span>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>An hour now</h2></div>
		<div class="rows">
			{#each data.rates as r (r.service + r.crew)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">{r.service} · {label(r.crew).toLowerCase()}</div>
						<div class="rec-s">{terms(r)}</div>
					</div>
					<div class="rec-n">
						{#if kept(r) !== null}
							<span class="rec-v" class:good={Number(kept(r)) > 0}>{money(kept(r))}</span>
							<span class="rec-x">kept</span>
						{:else}
							<span class="rec-v mut">—</span>
							<span class="rec-x">no rate set</span>
						{/if}
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">No rates set</span></div>
						<div class="rec-s">
							An hour needs both a price and a rate of pay to say what it keeps
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
