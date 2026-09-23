<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { dated } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	type Price = {
		id: string;
		crew: string | null;
		client: string | null;
		rate: string | null;
		effective_from: string;
		until: string | null;
		state: string;
		pays: string | null;
		keeps: string | null;
	};
	type Covered = {
		agreement_id: string;
		who: string;
		sites: string;
		allotment: string;
		responder: string | null;
	};
	type Service = {
		id: string;
		name: string;
		unit: string;
		delivery: string | null;
		basis: string;
		hours: string | null;
		overage: string | null;
		period: string | null;
		prices: Price[];
		covered: Covered[];
	};

	const services = $derived(data.services as Service[]);

	// A service gets its own heading when there is more than one thing to say
	// about it. The single-rate ones fall into one list at the bottom: a page of
	// one-row sections is a list with extra headings.
	const detailed = $derived(
		services.filter((s) => s.prices.length + s.covered.length > 1 || s.basis !== 'none')
	);
	const plain = $derived(services.filter((s) => !detailed.includes(s)));

	const per = (u: string) => (u === 'mile' ? '/mi' : u === 'hour' ? '/hr' : `/${u}`);

	/** Who a price applies to. The scope is the name of the row. */
	const scope = (p: Price) =>
		p.state === 'superseded'
			? 'Superseded'
			: (p.client ??
				(p.crew === 'one' ? 'One of you' : p.crew === 'team' ? 'Both of you' : 'Everyone else'));

	function detail(p: Price, s: Service): string {
		if (p.state === 'superseded')
			return `${dated(p.effective_from)} – ${p.until ? dated(p.until) : 'now'} · still priced on every line billed under it`;

		const bits: string[] = [];
		if (p.crew === 'one') bits.push(`Per ${s.unit} of the job · every client, no exceptions`);
		else if (p.crew === 'team') bits.push(`Per ${s.unit} of the job, not per person`);
		else if (s.basis === 'capped')
			bits.push(`Capped at ${Number(s.hours).toFixed(0)} hours a ${s.period}`);

		bits.push(
			p.state === 'scheduled'
				? `Takes over ${dated(p.effective_from)}`
				: `Since ${dated(p.effective_from)}`
		);
		return bits.join(' · ');
	}
</script>

<Top
	title="Services"
	sub="Billed to the client, paid to the partner"
	back={resolve('/more')}
	backLabel="More"
/>

<div class="pad">
	{#if services.length === 0}
		<p class="none">No services yet.</p>
	{:else}
		{#each detailed as s (s.id)}
			<div class="sec">
				<div class="sec-h">
					<h2>{s.name}</h2>
					{#if s.delivery}
						<span class="chip">{s.delivery === 'remote' ? 'remote' : 'on site'}</span>
					{/if}
				</div>
				<div class="rows">
					{#each s.prices as p (p.id)}
						<div
							class="rec"
							class:gone={p.state === 'superseded'}
							class:acc={p.state === 'scheduled'}
						>
							<div class="rec-m">
								<div class="rec-t">{scope(p)}</div>
								<div class="rec-s">{detail(p, s)}</div>
								{#if p.pays}
									<div class="rec-c">
										<span class="chip">
											{s.delivery === 'remote' ? 'responder' : 'pays'}
											{money(p.crew === 'team' ? String(Number(p.pays) / 2) : p.pays)}{p.crew ===
											'team'
												? ' ×2'
												: ''}
										</span>
										{#if p.keeps}<span class="chip good">keeps {money(p.keeps)}</span>{/if}
									</div>
								{/if}
							</div>
							<div class="rec-n">
								<span class="rec-v">{money(p.rate)}</span>
								<span class="rec-x">{per(s.unit)}</span>
							</div>
						</div>
					{/each}

					{#each s.covered as c (c.agreement_id)}
						<div class="rec acc">
							<div class="rec-m">
								<div class="rec-t">{c.sites}</div>
								<div class="rec-s">Inside the retainer — not billed by the hour at all</div>
								<div class="rec-c">
									{#if !c.responder}<span class="chip">no guaranteed payment</span>{/if}
									{#if c.allotment === 'unlimited'}
										<span class="chip acc">∞ unlimited</span>
									{:else}
										<span class="chip acc">capped</span>
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
						<div class="rec" class:warn={!p}>
							<div class="rec-m">
								<div class="rec-t">{s.name}</div>
								<div class="rec-s">
									{#if p}{detail(p, s)}{:else}Not priced — nothing can be billed under it yet{/if}
								</div>
								{#if p?.pays}
									<div class="rec-c">
										<span class="chip">pays {money(p.pays)}</span>
										{#if p.keeps}<span class="chip good">keeps {money(p.keeps)}</span>{/if}
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
