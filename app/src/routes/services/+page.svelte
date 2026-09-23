<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { dated, increment, pct } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	type Service = (typeof data.services)[number];
	type Price = Service['prices'][number];
	type Rule = Service['rules'][number];

	// A service gets its own heading when there is more than one thing to say
	// about it. The single-rate ones fall into one list at the bottom: a page of
	// one-row sections is a list with extra headings.
	const detailed = $derived(
		data.services.filter(
			(s) => s.prices.length + s.rules.length + s.covered.length > 1 || s.basis !== 'none'
		)
	);
	const plain = $derived(data.services.filter((s) => !detailed.includes(s)));

	const per = (u: string) => (u === 'mile' ? '/mi' : u === 'hour' ? '/hr' : ' each');

	/** When a row was, is, or will be in force. */
	function when(r: { state: string; effective_from: string; until: string | null }): string {
		if (r.state === 'superseded')
			return `${dated(r.effective_from)} – ${r.until ? dated(r.until) : 'now'}`;
		return r.state === 'scheduled'
			? `Takes over ${dated(r.effective_from)}`
			: `Since ${dated(r.effective_from)}`;
	}

	/** How a service is charged, before anybody's price. */
	function terms(s: Service): string {
		const bits = [`Charged per ${s.unit}`];
		if (s.unit === 'hour') bits.push(`billed ${increment(s.bill_to_nearest_seconds)}`);
		if (s.minimum_charge) bits.push(`at least ${money(s.minimum_charge)} an entry`);
		if (s.basis === 'capped')
			bits.push(`sold as ${Number(s.hours).toFixed(0)} hours a ${s.period} on subscription`);
		else if (s.basis === 'unlimited') bits.push('sold as unlimited on subscription');
		return bits.join(' · ');
	}

	function priceDetail(p: Price, s: Service): string {
		const bits = [when(p)];
		if (p.state === 'superseded') bits.push('still priced on every line billed under it');
		else if (Number(p.additional_rate) > 0)
			bits.push(`+${money(p.additional_rate)} for each additional person`);
		else if (s.unit === 'hour') bits.push('per hour of the job, however many work it');
		return bits.join(' · ');
	}

	/** What a rule pays, in the words the rule would be read aloud in. */
	function pays(r: Rule): { v: string; x: string } {
		switch (r.method) {
			case 'per_hour':
				return { v: money(r.amount), x: 'an hour' };
			case 'percent':
				return { v: pct(r.amount, 0), x: 'of the line' };
			case 'fixed':
				return { v: money(r.amount), x: 'an entry' };
			default:
				return { v: 'nothing', x: '' };
		}
	}

	/**
	 * What an hour leaves the business. One figure when everybody leaves the
	 * same; one per group when a person's own rule sets them apart; and a
	 * warning for anybody no rule reaches, because "keeps all of it" is how an
	 * unpaid person looks from here.
	 */
	function keeps(s: Service): { text: string; warn: boolean }[] {
		const paid = s.kept.filter((k) => !k.unpaid);
		return [
			...paid.map((k) => ({
				text:
					paid.length === 1
						? `keeps ${money(k.kept)} an hour`
						: `keeps ${money(k.kept)} on an hour of ${k.who}'s`,
				warn: false
			})),
			...s.kept.filter((k) => k.unpaid).map((k) => ({ text: `no rule pays ${k.who}`, warn: true }))
		];
	}
</script>

<Top
	title="Services"
	sub="What is sold, what it costs, and who it pays"
	back={resolve('/more')}
	backLabel="More"
/>

<div class="pad">
	{#if data.services.length === 0}
		<p class="none">No services yet.</p>
	{:else}
		{#each detailed as s (s.id)}
			<div class="sec">
				<div class="sec-h"><h2>{s.name}</h2></div>
				<div class="rows">
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{terms(s)}</div>
							{#if s.kept.length}
								<div class="rec-c">
									{#each keeps(s) as k (k.text)}
										<span class="chip" class:good={!k.warn} class:warn={k.warn}>{k.text}</span>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					{#each s.prices as p (p.id)}
						<div
							class="rec"
							class:gone={p.state === 'superseded'}
							class:acc={p.state === 'scheduled'}
						>
							<div class="rec-m">
								<div class="rec-t">
									{p.client ?? 'Every client'}<span class="lt"> · price</span>
								</div>
								<div class="rec-s">{priceDetail(p, s)}</div>
							</div>
							<div class="rec-n">
								<span class="rec-v">{money(p.rate)}</span>
								<span class="rec-x">{per(s.unit)}</span>
							</div>
						</div>
					{/each}

					{#each s.rules as r (r.id)}
						{@const w = pays(r)}
						<div
							class="rec"
							class:gone={r.state === 'superseded'}
							class:acc={r.state === 'scheduled'}
						>
							<div class="rec-m">
								<div class="rec-t">
									{r.payee}<span class="lt">
										· {r.pays_for === 'vehicle' ? 'for their vehicle' : 'for their time'}</span
									>
								</div>
								<div class="rec-s">{r.client ?? 'Every client'} · {when(r)}</div>
								<div class="rec-c">
									<span class="chip">{r.is_role ? 'Role' : 'One person'}</span>
									{#if r.pays_for === 'vehicle'}
										<span class="chip">Not applied yet — a trip does not record its vehicle</span>
									{/if}
								</div>
							</div>
							<div class="rec-n">
								<span class="rec-v" class:mut={r.method === 'nothing'}>{w.v}</span>
								{#if w.x}<span class="rec-x">{w.x}</span>{/if}
							</div>
						</div>
					{/each}

					{#each s.covered as c (c.agreement_id)}
						<div class="rec acc">
							<div class="rec-m">
								<div class="rec-t">{c.sites}</div>
								<div class="rec-s">Inside the retainer — not billed by the hour at all</div>
								<div class="rec-c">
									{#if c.allotment === 'unlimited'}
										<span class="chip acc">∞ unlimited</span>
									{:else}
										<span class="chip acc">
											{Number(c.hours).toFixed(0)} hours{c.basis === 'per_location'
												? ' a site'
												: ''}, then {c.overage === 'bill'
												? 'billed'
												: c.overage === 'deny'
													? 'refused'
													: 'free'}
										</span>
									{/if}
								</div>
							</div>
							<div class="rec-n"><span class="rec-v mut">retainer</span></div>
						</div>
					{/each}

					{#if s.prices.length === 0 && s.covered.length === 0}
						<div class="rec warn">
							<div class="rec-m">
								<div class="rec-t">Not priced</div>
								<div class="rec-s">Nothing can be billed under it yet</div>
							</div>
							<div class="rec-n"><span class="rec-v mut">—</span></div>
						</div>
					{/if}
				</div>
			</div>
		{/each}

		{#if plain.length}
			<div class="sec">
				<div class="sec-h"><h2>Everything else</h2></div>
				<div class="rows">
					{#each plain as s (s.id)}
						{@const p = s.prices[0]}
						{@const r = s.rules[0]}
						<div class="rec" class:warn={!p}>
							<div class="rec-m">
								<div class="rec-t">{s.name}</div>
								<div class="rec-s">
									{#if p}{terms(s)} · {when(p)}{:else}Not priced — nothing can be billed under it
										yet{/if}
								</div>
								{#if r}
									<div class="rec-c">
										<span class="chip">{r.payee}: {pays(r).v} {pays(r).x}</span>
									</div>
								{/if}
							</div>
							<div class="rec-n">
								{#if p}
									<span class="rec-v">{money(p.rate)}</span>
									<span class="rec-x">{per(s.unit)}</span>
								{:else}
									<span class="rec-v mut">—</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>
