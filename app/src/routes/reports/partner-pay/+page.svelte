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
		j.crew === 'team' ? 'The team' : (j.who ?? 'nobody recorded');

	// Built here rather than in the markup: a template that interleaves text
	// with {#if} blocks loses the space between them.
	const terms = (r: { billed: string; paid: string | null; since: string | null }) =>
		[
			`${money(r.billed)} billed`,
			r.paid === null ? 'no rule pays it' : `${money(r.paid)} paid`,
			r.since ? `since ${dated(r.since)}` : null
		]
			.filter(Boolean)
			.join(' · ');
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
							{who(j)} · {Number(j.hours).toFixed(4)} h{#if j.heads > 1}
								· {j.heads} on the job{/if}
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
			{#each data.rates as r (r.service_id + r.crew + r.who)}
				<div class="rec" class:warn={r.unpaid}>
					<div class="rec-m">
						<div class="rec-t">{r.service} · {r.who}</div>
						<div class="rec-s">{terms(r)}</div>
					</div>
					<div class="rec-n">
						<span class="rec-v" class:good={!r.unpaid && Number(r.kept) > 0}>{money(r.kept)}</span>
						<span class="rec-x">kept</span>
					</div>
				</div>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing priced by the hour</span></div>
						<div class="rec-s">An hour needs a price before it can say what it keeps</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
