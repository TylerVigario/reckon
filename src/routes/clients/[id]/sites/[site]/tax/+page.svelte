<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import Octicon from '#lib/Octicon.svelte';
	import { dated, levied, pct } from '#lib/format.ts';
	import { Decimal } from '#lib/decimal.ts';
	import { readJson, readProblem } from '#lib/json.ts';
	import type { PageProps } from './$types';
	import { busy } from '#lib/busy.svelte.ts';
	import { resolve } from '$app/paths';
	import Outside from '#lib/Outside.svelte';
	import { AGENCY, whereToLook } from '#lib/state-agencies.ts';
	import { NO_SALES_TAX, stateName, type State } from '#lib/us-states.ts';

	/**
	 * A site's tax. In California, where the business collects there, what
	 * CDTFA has said of it: what is charged there and who levies it, the area
	 * it is in, and when CDTFA was last asked -- none of it ours to set.
	 * Anywhere else the business collects, the typed area a person chose for
	 * it from the state's own lookup, chosen again here. In a state the
	 * business does not collect in, that nothing is taxed there. Then where it
	 * has been placed, how and by whom.
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
		const r = await fetch(`/api/clients/${s.client_slug}/sites/${s.slug}/area`, {
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

	// Why it was placed, the area it was in then, said as a move where that
	// was another than before, and by whom where somebody did it.
	const why = (c: {
		note: string | null;
		area: string;
		moved: boolean;
		first: boolean;
		by: string | null;
	}) =>
		[
			c.note ? c.note[0].toUpperCase() + c.note.slice(1) : null,
			c.moved && !c.first ? `Now in ${c.area}` : c.area,
			c.by ? `by ${c.by}` : null
		]
			.filter(Boolean)
			.join(' · ');

	/**
	 * CHOOSING ITS AREA (18 November 2026), where nothing answers for an
	 * address: one of the state's typed areas, picked beside the state's own
	 * lookup. Chosen, it stays until someone moves it, and its rate is as
	 * current as its area's confirmation.
	 */
	const agency = $derived(AGENCY[s.region as State]);
	let choice = $state('');
	$effect(() => {
		if (!choice) choice = s.area_id ?? '';
	});
	let choosing = $state(false);
	let chose = $state<{ good: boolean; text: string } | null>(null);
	async function choose() {
		if (!choice) {
			chose = { good: false, text: `Choose one of ${stateName(s.region)}’s areas.` };
			return;
		}
		choosing = true;
		chose = null;
		const r = await fetch(`/api/clients/${s.client_slug}/sites/${s.slug}/area`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { area: choice } })
		}).catch(() => null);
		choosing = false;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			chose = {
				good: false,
				text: !p ? 'Not saved — no connection.' : (p.errors?.area ?? p.detail ?? 'Not saved.')
			};
			return;
		}
		const a = (await readJson(r)) as { name: string };
		chose = {
			good: true,
			text: `In ${a.name}. Lines written here from now on are charged at its rate.`
		};
		await refreshAll();
	}
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
{:else if data.areas}
	<section class="box" aria-labelledby="area-h">
		<div class="box-h"><h2 class="box-t" id="area-h">Tax area</h2></div>
		{#if chose}
			<p class="box-row im {chose.good ? 'good' : 'crit'}" role={chose.good ? 'status' : 'alert'}>
				<Octicon name={chose.good ? 'check' : 'alert'} />{chose.text}
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
						>{s.area_code ? `Code ${s.area_code} · ` : ''}chosen {dated(s.verified_on)}</span
					>
				</span>
			</div>
			<div class="box-row kv">
				<span class="kv-l">Confirmed</span>
				<span class="kv-v">
					<span>{dated(s.confirmed_on)}</span>
					<span class="kv-s">Its area’s rate, against the state’s own table</span>
					{#if s.stale}
						<span class="im warn"
							><Octicon name="alert" /><span
								>Not since this quarter began, when rates and boundaries change.{#if s.area_id && !field}
									<a
										href={resolve('/settings/tax/[state]/[area]', {
											state: s.region,
											area: s.area_id
										})}>Confirm it</a
									>{/if}</span
							></span
						>
					{/if}
				</span>
			</div>
		{:else}
			<div class="box-row kv">
				<span class="kv-l">Area</span>
				<span class="kv-v">
					<span>None chosen yet</span>
					<span class="kv-s">Nothing billed here can be taxed until it is in one.</span>
				</span>
			</div>
		{/if}
		{#if !field}
			{#if data.areas.length}
				<form
					class="box-row pick"
					onsubmit={(e) => {
						e.preventDefault();
						void choose();
					}}
				>
					<label class="fc-l" for="t-area">{placed ? 'Move it to' : 'Its area'}</label>
					<div class="row">
						<select id="t-area" class="ti" bind:value={choice}>
							{#if !placed}<option value="">Choose…</option>{/if}
							{#each data.areas as a (a.id)}
								<option value={a.id}>{a.name} · {pct(a.rate_pct)}</option>
							{/each}
						</select>
						<button
							type="submit"
							class="btn"
							disabled={placed && choice === s.area_id}
							{@attach busy(choosing && 'Saving')}>{placed ? 'Move it' : 'Choose'}</button
						>
					</div>
					{#if agency}
						<p class="fc-c">
							Find it with <Outside href={whereToLook(agency)}
								>{agency.lookup
									? `${agency.name}’s address lookup`
									: `${agency.name}’s rates`}</Outside
							>.
						</p>
					{/if}
				</form>
			{:else}
				<p class="box-row none">
					No area of {stateName(s.region)} is typed in yet.
					<a
						href="{resolve('/settings/tax/[state]/new', {
							state: s.region
						})}?for={encodeURIComponent(s.client_slug)}/{encodeURIComponent(s.slug)}"
						>Type its area in</a
					>{agency ? ' from ' : ''}{#if agency}<Outside href={agency.rates}
							>{agency.name}’s table</Outside
						>{/if}.
				</p>
			{/if}
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
	.pick {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-height: 0;
		padding-block: 12px;
	}
	.pick .row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.pick select {
		flex: 1 1 12rem;
		min-width: 0;
	}
	.pick .fc-c,
	.none {
		margin: 0;
	}
	.none {
		min-height: 0;
		padding-block: 12px;
		color: var(--fgColor-muted);
	}
</style>
