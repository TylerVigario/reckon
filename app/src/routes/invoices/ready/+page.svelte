<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { day } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	// The two lines under a row's title: who it goes to with what tax and why,
	// then what it is made of. An absent part is dropped rather than shown empty
	// -- a row reading "· · period close" says less than one reading "period
	// close", and an empty first line leaves a hole above the second.
	const lines = (d: {
		contact: string | null;
		area: string | null;
		rate_pct: string | null;
		period_end: string | null;
		made_of: string | null;
	}) => {
		const who = [
			d.contact,
			d.rate_pct && Number(d.rate_pct) > 0
				? `${d.area ? d.area + ' ' : ''}${Number(d.rate_pct).toFixed(3)}%`
				: null,
			d.period_end ? 'period close' : null
		]
			.filter(Boolean)
			.join(' · ');
		const made = d.made_of ? d.made_of.charAt(0).toUpperCase() + d.made_of.slice(1) : '';
		return [who, made].filter(Boolean);
	};

	const sub = $derived(
		`${data.drafts.length} ${data.drafts.length === 1 ? 'draft' : 'drafts'} · ${money(data.total)}`
	);
</script>

<Top title="Ready to send" {sub} back={resolve('/')} backLabel="Today" />

<div class="pad">
	<div class="sec">
		<div class="sec-h">
			<h2>Built, none sent</h2>
			<span class="sp"></span>
			<span class="chip">Review and send · never auto-sent</span>
		</div>
		<div class="rows">
			{#each data.drafts as d (d.id)}
				<a class="rec link" class:warn={d.aged} href={resolve('/invoices/[id]', { id: d.id })}>
					<div class="rec-m">
						<div class="rec-t">{d.number} · {d.who}</div>
						<div class="rec-s">
							{#each lines(d) as l, i (i)}{#if i}<br />{/if}{l}{/each}
						</div>
						{#if d.aged}
							<div class="rec-c">
								<span class="chip warn">
									<span class="dot"></span>Worked {day(d.oldest_worked_on)}, {d.days_waiting} days ago
								</span>
							</div>
						{/if}
					</div>
					<div class="rec-n">
						<span class="rec-v">{money(d.gross)}</span>
						<span class="rec-x">{d.lines} {Number(d.lines) === 1 ? 'line' : 'lines'}</span>
					</div>
					<span class="arw" aria-hidden="true">›</span>
				</a>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing drafted</span></div>
						<div class="rec-s">
							Work becomes a draft at a period close, or when it has waited past {data.alertDays}
							days
						</div>
					</div>
				</div>
			{/each}
			{#if data.drafts.length}
				<div class="rec tot">
					<div class="rec-m">
						<div class="rec-t">
							{data.drafts.length}
							{data.drafts.length === 1 ? 'draft' : 'drafts'}
						</div>
					</div>
					<div class="rec-n"><span class="rec-v">{money(data.total)}</span></div>
				</div>
			{/if}
		</div>
	</div>
</div>
