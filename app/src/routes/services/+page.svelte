<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { dated, increment } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import { paysWhat } from '$lib/pay-words';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	type Service = (typeof data.services)[number];

	const offered = $derived(data.services.filter((s) => s.active));
	const retired = $derived(data.services.filter((s) => !s.active));

	const per = (u: string) => (u === 'mile' ? '/mi' : u === 'hour' ? '/hr' : ' each');

	/** The price every client pays today -- the figure a service is known by. */
	const priceOf = (s: Service) =>
		s.prices.find((p) => p.client === null && p.state === 'current') ?? null;

	/** How it is charged, beyond the figure: heads, increment, minimum. */
	function terms(s: Service): string {
		const p = priceOf(s);
		const bits = [`Per ${s.unit}`];
		if (p && s.unit === 'hour' && Number(p.additional_rate) > 0)
			bits.push(`+${money(p.additional_rate)} each additional person`);
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
			const w = paysWhat(r, money);
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
		for (const c of s.covered) out.push({ text: `${c.who} retainer`, tone: 'acc' });
		const next = s.prices.find((p) => p.state === 'scheduled');
		if (next) out.push({ text: `changes ${dated(next.effective_from)}`, tone: 'acc' });
		return out;
	}
</script>

<Top
	title="Services"
	sub="What is sold, and what it costs"
	back={resolve('/more')}
	backLabel="More"
>
	{#snippet actions()}
		<a class="btn sm pri" href={resolve('/services/new')}>New service</a>
	{/snippet}
</Top>

<div class="pad">
	{#if data.services.length === 0}
		<p class="none">No services yet.</p>
	{/if}

	{#each [{ head: '', list: offered }, { head: 'Retired', list: retired }] as group (group.head)}
		{#if group.list.length}
			<div class="sec">
				{#if group.head}<div class="sec-h"><h2>{group.head}</h2></div>{/if}
				<div class="rows">
					{#each group.list as s (s.id)}
						{@const p = priceOf(s)}
						<a
							class="rec link"
							class:gone={!s.active}
							class:warn={s.active && !p && s.covered.length === 0}
							href={resolve('/services/[id]', { id: s.id })}
						>
							<div class="rec-m">
								<div class="rec-t">{s.name}</div>
								<div class="rec-s">
									{p ? terms(s) : 'Not priced — nothing can be billed under it yet'}
								</div>
								{#if s.active && notes(s).length}
									<div class="rec-c">
										{#each notes(s) as n (n.text)}
											<span
												class="chip"
												class:good={n.tone === 'good'}
												class:acc={n.tone === 'acc'}
												class:warn={n.tone === 'warn'}>{n.text}</span
											>
										{/each}
									</div>
								{/if}
							</div>
							<div class="rec-n">
								<span class="rec-v" class:mut={!p}>{p ? money(p.rate) : '—'}</span>
								{#if p}<span class="rec-x">{per(s.unit)}</span>{/if}
							</div>
							<span class="arw" aria-hidden="true">›</span>
						</a>
					{/each}
				</div>
			</div>
		{/if}
	{/each}
</div>
