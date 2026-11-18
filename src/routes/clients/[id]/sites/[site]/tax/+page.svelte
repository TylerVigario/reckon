<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import Octicon from '#lib/Octicon.svelte';
	import { dated, levied, pct } from '#lib/format.ts';
	import { Decimal } from '#lib/decimal.ts';
	import { readJson, readProblem } from '#lib/json.ts';
	import type { PageProps } from './$types';
	import { busy } from '#lib/busy.svelte.ts';
	import { NO_SALES_TAX, stateName, type State } from '#lib/us-states.ts';

	/**
	 * A site's tax. In California, where the business collects there, what
	 * CDTFA has said of it: what is charged there and who levies it, the area
	 * it is in, and when CDTFA was last asked -- none of it ours to set. In a
	 * state the business does not collect in, that nothing is taxed there. Then
	 * where it has been placed.
	 */
	let { data }: PageProps = $props();
	const s = $derived(data.site);
	const field = $derived(data.user?.access === 'field');
	const made = $derived(levied(s.pieces));
	// CDTFA is asked about a California site, where the business collects there.
	const asks = $derived(s.collected && s.region === 'CA');
	const placed = $derived(s.rate_pct !== null);

	/**
	 * ASK CDTFA AGAIN (7 November 2026), in the box's header as GitHub puts
	 * Check for updates beside Last checked. What CDTFA answers is said under
	 * it, as Primer's inline message, and goes into the history whether the
	 * rate moved or not.
	 */
	let asking = $state(false);
	let answered = $state<{ good: boolean; text: string } | null>(null);
	async function askAgain() {
		asking = true;
		answered = null;
		const r = await fetch(`/api/clients/${s.client_slug}/sites/${s.slug}/ask-cdtfa`, {
			method: 'POST'
		}).catch(() => null);
		asking = false;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			answered = {
				good: false,
				text: !r
					? 'CDTFA was not asked — no connection.'
					: r.status === 502
						? `${p?.detail ?? 'CDTFA did not answer.'} Nothing has changed.`
						: (p?.detail ?? 'CDTFA was not asked.')
			};
			if (r?.status === 409) await refreshAll();
			return;
		}
		const a = (await readJson(r)) as { rate: string; was: string | null; changed: boolean };
		answered = {
			good: true,
			text:
				a.was === null
					? `CDTFA says ${pct(a.rate)}. Lines written here from now on are charged at it.`
					: a.changed
						? `CDTFA now says ${pct(a.rate)}, ${Decimal.from(a.rate).gt(a.was) ? 'up' : 'down'} from ${pct(a.was)}. Lines written here from now on are charged at it.`
						: `CDTFA still says ${pct(a.rate)}.`
		};
		await refreshAll();
	}

	// Why it was asked, and the area its address was in then, said as a move
	// where that was another than before.
	const why = (c: { note: string | null; area: string; moved: boolean; first: boolean }) =>
		[
			c.note ? c.note[0].toUpperCase() + c.note.slice(1) : null,
			c.moved && !c.first ? `Now in ${c.area}` : c.area
		]
			.filter(Boolean)
			.join(' · ');
</script>

{#if !s.collected}
	<section class="box" aria-labelledby="tax-h">
		<div class="box-h"><h2 class="box-t" id="tax-h">Tax</h2></div>
		<div class="box-row kv">
			<span class="kv-l">Rate</span>
			<span class="kv-v">
				<span>Not taxed</span>
				<span class="kv-s"
					>{NO_SALES_TAX.includes(s.region as State)
						? `${stateName(s.region)} has no sales tax.`
						: `The business doesn’t collect tax in ${stateName(s.region)}.`}</span
				>
			</span>
		</div>
	</section>
{:else if asks}
	<section class="box" aria-labelledby="cdtfa-h">
		<div class="box-h">
			<h2 class="box-t" id="cdtfa-h">What CDTFA has said</h2>
			{#if !field}
				<button
					type="button"
					class="btn sm"
					onclick={askAgain}
					{@attach busy(asking && 'Asking CDTFA')}
					>{placed ? 'Ask CDTFA again' : 'Ask CDTFA'}</button
				>
			{/if}
		</div>
		{#if answered}
			<p
				class="box-row im {answered.good ? 'good' : 'crit'}"
				role={answered.good ? 'status' : 'alert'}
			>
				<Octicon name={answered.good ? 'check' : 'alert'} />{answered.text}
			</p>
		{/if}
		{#if placed}
			<div class="box-row kv">
				<span class="kv-l">Rate</span>
				<span class="kv-v">
					<span class="rt">{pct(s.rate_pct)}</span>
					<span class="kv-s">{made}</span>
				</span>
			</div>
			<div class="box-row kv">
				<span class="kv-l">Area</span>
				<span class="kv-v">
					<span>{s.area}</span>
					<span class="kv-s"
						>{s.area_code ? `Tax area ${s.area_code} · ` : ''}nothing here is ours to set</span
					>
				</span>
			</div>
			<div class="box-row kv">
				<span class="kv-l">Last asked</span>
				<span class="kv-v">
					<span>{dated(s.verified_on)}</span>
					<span class="kv-s">Its area’s rate confirmed {dated(s.confirmed_on)}</span>
					{#if s.stale}
						<span class="im warn"
							><Octicon name="alert" />Not since this quarter began, when a district can start or
							end.</span
						>
					{/if}
				</span>
			</div>
		{:else}
			<div class="box-row kv">
				<span class="kv-l">Area</span>
				<span class="kv-v">
					<span>Not asked yet</span>
					<span class="kv-s"
						>Nothing billed here can be taxed until CDTFA says which area it is in. The server asks
						as it keeps rates in sync.</span
					>
				</span>
			</div>
		{/if}
	</section>
{:else}
	<section class="box" aria-labelledby="tax-h">
		<div class="box-h"><h2 class="box-t" id="tax-h">Tax</h2></div>
		<div class="box-row kv">
			<span class="kv-l">Area</span>
			<span class="kv-v">
				<span>In no tax area yet</span>
				<span class="kv-s">Nothing billed here can be taxed until it is in one.</span>
			</span>
		</div>
	</section>
{/if}

{#if data.placements.length}
	<section class="box" aria-labelledby="history-h">
		<div class="box-h"><h2 class="box-t" id="history-h">History</h2></div>
		{#each data.placements as c (c.id)}
			<div class="box-row was">
				<span class="who">
					<span class="n">{dated(c.on)}</span>
					<span class="sub">{why(c)}</span>
				</span>
				<span class="r">{pct(c.rate_pct)}</span>
			</div>
		{/each}
		{#if s.asked > data.placements.length}
			<p class="box-row more">The latest {data.placements.length} of {s.asked}.</p>
		{/if}
	</section>
{/if}

<style>
	.box-row {
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.rt,
	.r {
		font-variant-numeric: tabular-nums;
	}
	.n {
		font-weight: 600;
	}
	.sub,
	.more {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.more {
		min-height: 0;
	}
	.was {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.who {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.r {
		color: var(--fgColor-muted);
	}
	/* Primer's inline message: an icon and a line, in the colour of what happened. */
	.im {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		font-size: 12px;
		line-height: 18px;
	}
	.im :global(svg) {
		margin-top: 1px;
	}
	p.im {
		min-height: 0;
		font-size: 14px;
		line-height: 20px;
	}
	p.im :global(svg) {
		margin-top: 2px;
	}
	.im.good {
		color: var(--fgColor-success);
	}
	.im.warn {
		color: var(--fgColor-attention);
	}
	.im.crit {
		color: var(--fgColor-danger);
	}
</style>
