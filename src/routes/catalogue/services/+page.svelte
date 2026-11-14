<script lang="ts">
	import StockOnPhone from '#lib/StockOnPhone.svelte';
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { catalogueTabs } from '#lib/section-tabs.ts';
	import { dated, increment } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { paysWhat } from '#lib/pay-words.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	/**
	 * Services: what time and miles are charged as, as Primer boxes -- those
	 * offered, then those retired -- with a row each: what it charges and how,
	 * and labels for who it pays, what it keeps, which clients are priced or
	 * covered differently, and what is about to change. Each row opens the
	 * service, where all of that is set. New service is the screen's action.
	 */
	let { data }: PageProps = $props();

	type Service = (typeof data.services)[number];

	const offered = $derived(data.services.filter((s) => s.active));
	const retired = $derived(data.services.filter((s) => !s.active));

	const per = (u: string) => (u === 'mile' ? 'a mile' : u === 'hour' ? 'an hour' : 'each');

	/** The price every client pays today -- the figure a service is known by. */
	const priceOf = (s: Service) =>
		s.prices.find((p) => p.client === null && p.state === 'current') ?? null;

	/** How it is charged, beyond the figure: heads, increment, minimum. */
	function terms(s: Service): string {
		const p = priceOf(s);
		const bits = [`Per ${s.unit}`];
		if (p && s.unit === 'hour' && Number(p.additional_rate) > 0)
			bits.push(`+${unitPrice(p.additional_rate)} each additional person`);
		if (s.unit === 'hour') bits.push(`billed ${increment(s.bill_to_nearest_seconds)}`);
		if (s.minimum_charge) bits.push(`at least ${money(s.minimum_charge)}`);
		return bits.join(' · ');
	}

	/**
	 * Everything else worth knowing at a glance, small: who it pays, what it
	 * keeps, which clients are priced or covered differently, and what is about
	 * to change. The pay is here and not the headline -- a service is what it
	 * charges first.
	 */
	function notes(s: Service): { text: string; tone: '' | 'good' | 'acc' | 'warn' }[] {
		const out: { text: string; tone: '' | 'good' | 'acc' | 'warn' }[] = [];
		// Every client's rules, said; a client's own are counted, and read on
		// the service.
		const live = s.rules.filter((r) => r.state === 'current');
		for (const r of live.filter((r) => r.client === null)) {
			const w = paysWhat(r, { money, unitPrice });
			out.push({ text: `${r.payee} ${w.v}${w.x ? ` ${w.x}` : ''}`, tone: '' });
		}
		const theirs = live.filter((r) => r.client !== null).length;
		if (theirs) out.push({ text: `${theirs} client rule${theirs === 1 ? '' : 's'}`, tone: '' });
		const paid = s.kept.filter((k) => !k.unpaid);
		if (paid.length === 1) out.push({ text: `keeps ${money(paid[0].kept)} an hour`, tone: 'good' });
		for (const k of s.kept.filter((k) => k.unpaid))
			out.push({ text: `no rule pays ${k.who}`, tone: 'warn' });
		const own = s.prices.filter((p) => p.client !== null && p.state === 'current').length;
		if (own) out.push({ text: `${own} client price${own === 1 ? '' : 's'}`, tone: '' });
		// A client's agreements are one note: Harbor Light's two offices are one client.
		for (const who of new Set(s.covered.map((c) => c.who))) {
			const theirs = s.covered.filter((c) => c.who === who);
			const sites = theirs.filter((c) => c.site).length;
			out.push({
				text:
					sites === 0
						? `${who} retainer`
						: `${who} · ${sites} site retainer${sites === 1 ? '' : 's'}`,
				tone: 'acc'
			});
		}
		const next = s.prices.find((p) => p.state === 'scheduled');
		if (next) out.push({ text: `changes ${dated(next.effective_from)}`, tone: 'acc' });
		return out;
	}
</script>

<Top title="Catalogue" sub="What can go on a line" back={resolve('/more')} backLabel="More">
	{#snippet actions()}
		<a class="btn sm pri" href={resolve('/catalogue/services/new')}>New service</a>
	{/snippet}
</Top>

<div class="pad primer">
	<UnderlineNav label="Catalogue" items={catalogueTabs('services')} />
	<StockOnPhone today={data.today} />

	{#each [{ key: 'offered', head: 'Offered', list: offered }, { key: 'retired', head: 'Retired', list: retired }] as group (group.key)}
		{#if group.list.length || group.key === 'offered'}
			<section class="box" aria-labelledby="{group.key}-h">
				<div class="box-h">
					<h2 class="box-t" id="{group.key}-h">{group.head}</h2>
					<span class="count">{group.list.length}</span>
				</div>
				{#each group.list as s (s.id)}
					{@const p = priceOf(s)}
					{@const said = s.active ? notes(s) : []}
					<a class="box-row" href={resolve('/catalogue/services/[id]', { id: s.id })}>
						<span class="what">
							<span class="n">{s.name}</span>
							<span class="sub">
								{p ? terms(s) : 'Not priced: nothing can be billed under it yet'}
							</span>
							{#if said.length}
								<span class="labs">
									{#each said as n (n.text)}
										<span class="lab {n.tone}">{n.text}</span>
									{/each}
								</span>
							{/if}
						</span>
						{#if s.active && !p && s.covered.length === 0}
							<span class="lab warn">Not priced</span>
						{/if}
						<span class="fig">
							<span class="v" class:muted={!p}>{p ? unitPrice(p.rate) : '—'}</span>
							{#if p}<span class="sub">{per(s.unit)}</span>{/if}
						</span>
					</a>
				{:else}
					<p class="box-row muted">No services yet. New service adds the first.</p>
				{/each}
			</section>
		{/if}
	{/each}
</div>

<style>
	.box-row {
		min-height: 64px;
		box-sizing: border-box;
		margin: 0;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-wrap: anywhere;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--ink-3);
	}
	.labs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}
	.lab {
		flex: 0 0 auto;
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.v {
		font-family: var(--f-mono);
		font-weight: 600;
	}
</style>
