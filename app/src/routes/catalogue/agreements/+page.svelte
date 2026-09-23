<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const hrs = (v: string | null | undefined) => (v ? `${Number(v).toFixed(2)} h` : '—');
	const PERIOD: Record<string, string> = {
		weekly: 'week',
		monthly: 'month',
		quarterly: 'quarter',
		annually: 'year'
	};
	const per = (i: string) =>
		i === 'monthly' ? '/mo' : i === 'annually' ? '/yr' : i === 'quarterly' ? '/qtr' : '/wk';

	const pays = (r: { pays_for: string; method: string; amount: string | null }) =>
		r.method === 'nothing'
			? 'nothing'
			: r.method === 'percent'
				? `${Number(r.amount)}% of ${r.pays_for === 'covered_time' ? 'the retainer' : 'the line'}`
				: `${money(r.amount)} ${r.method === 'per_hour' ? 'an hour' : 'an entry'}`;

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
								{a.basis === 'per_location'
									? `${money(a.price)} a site, ${a.site_count} ${a.site_count === 1 ? 'site' : 'sites'}`
									: 'Flat'}{a.sites ? ` · ${a.sites}` : ''}
							</div>
							{#each a.covers as c (c.service)}
								<div class="rec-s">
									{c.service} · {hrs(c.used)} used this month of {c.allotment === 'unlimited'
										? 'unlimited'
										: hrs(c.hours)}
								</div>
							{:else}
								<div class="rec-s">Covers no service — everything is billed</div>
							{/each}
							{#each a.pay as r (r.service + r.payee + r.pays_for)}
								<div class="rec-s">
									{r.payee} paid {pays(r)} for {r.pays_for === 'covered_time'
										? 'covered '
										: ''}{r.service}
								</div>
							{/each}
							<div class="rec-c">
								{#each a.covers as c (c.service)}
									{#if c.allotment === 'unlimited'}
										<span class="chip acc">∞ {c.service}</span>
									{/if}
								{/each}
								{#if a.now.state === 'given'}
									<span class="chip good">this {PERIOD[a.interval] ?? 'period'} given freely</span>
								{:else if a.now.state === 'uncharged'}
									<span class="chip warn"
										>this {PERIOD[a.interval] ?? 'period'} not charged yet</span
									>
								{/if}
							</div>
						</div>
						<div class="rec-n">
							<span class="rec-v">{money(a.charge)}</span>
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
				<h2>{data.subscriptions.length ? 'On the service’s own terms instead' : 'No agreement'}</h2>
			</div>
			<div class="rows">
				{#each data.uncovered as e (e.id)}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{e.name}</div>
							{#each data.subscriptions as s (s.id)}
								<div class="rec-s">
									{s.name}
									{s.basis === 'unlimited'
										? 'unlimited'
										: `${hrs(s.hours)} included per ${s.period}`} · {hrs(e.used[s.id] ?? '0')} used
								</div>
							{:else}
								<div class="rec-s">Nothing included</div>
							{/each}
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
