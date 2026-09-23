<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const hrs = (v: string | null) => (v === null ? '—' : `${Number(v).toFixed(2)} h`);
	const per = (i: string) =>
		i === 'monthly' ? '/mo' : i === 'annually' ? '/yr' : i === 'quarterly' ? '/qtr' : '/wk';

	const sub = $derived(
		[
			`${money(data.recurring)} a month`,
			data.live.find((a) => a.agreed_with)
				? `agreed with ${data.live.find((a) => a.agreed_with)?.agreed_with}`
				: null
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<Top title="Agreements" {sub} back={resolve('/catalogue')} backLabel="Catalogue" />

<div class="pad">
	{#if data.live.length}
		<div class="sec">
			<div class="sec-h">
				<h2>Live</h2>
				<span class="sp"></span>
				<span class="chip">Billed on the day each began</span>
			</div>
			<div class="rows">
				{#each data.live as a (a.id)}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{a.who}</div>
							<div class="rec-s">
								{a.basis}{a.sites ? ` · ${a.sites}` : ''}
								<br />Remote {a.allotment === 'unlimited'
									? 'unlimited'
									: `${hrs(a.pooled ?? a.cap)} included`} · {hrs(a.used)} used this month
							</div>
							<div class="rec-c">
								{#if a.allotment === 'unlimited'}
									<span class="chip acc">∞ uncapped</span>
								{:else}
									<span class="chip acc">{hrs(a.pooled ?? a.cap)}</span>
								{/if}
								<span class="chip">
									{a.responder ? `${money(a.responder)} to the responder` : 'no responder pay'}
								</span>
							</div>
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(a.price)}</span>
							<span class="rec-x">{per(a.interval)}</span>
						</div>
					</div>
				{/each}
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Recurring revenue</div></div>
					<div class="rec-n">
						<span class="rec-v">{money(data.recurring)}</span><span class="rec-x">/mo</span>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if data.uncovered.length}
		<div class="sec">
			<div class="sec-h">
				<h2>
					{data.fallback?.hours
						? `On the ${Number(data.fallback.hours).toFixed(0)}-hour cap instead`
						: 'No agreement'}
				</h2>
			</div>
			<div class="rows">
				{#each data.uncovered as e (e.id)}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{e.name}</div>
							<div class="rec-s">
								{data.fallback?.hours
									? `Whatever the service includes, per ${data.fallback.period}`
									: 'Nothing included'}
							</div>
						</div>
						<div class="rec-n">
							<span class="rec-v mut">
								{data.fallback?.hours ? hrs(data.fallback.hours) : '—'}
							</span>
							<span class="rec-x">{hrs(e.used)} used</span>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if data.live.length === 0 && data.uncovered.length === 0}
		<p class="none">No agreements yet.</p>
	{/if}
</div>
