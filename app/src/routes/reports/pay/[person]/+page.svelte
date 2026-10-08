<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { day, dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { sum } from '#lib/decimal.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	const HOW = ['Bank transfer', 'Cash', 'Check', 'Other'];
	// Made once, so a payment sent twice is one payment.
	const clientUuid = crypto.randomUUID();

	// Everything owed that has a figure starts ticked; what no rule pays cannot be.
	let ticked = $state<string[]>(
		untrack(() => data.items.filter((i) => i.amount !== null).map((i) => `${i.kind}:${i.id}`))
	);
	const toggle = (key: string) =>
		(ticked = ticked.includes(key) ? ticked.filter((k) => k !== key) : [...ticked, key]);
	let correcting = $state(false);
	let correctTo = $state(untrack(() => data.payments[0]?.id ?? ''));
	let correctAmount = $state('');
	let correctWhy = $state('');
	let paidOn = $state(untrack(() => data.today));
	let how = $state(HOW[0]);
	let note = $state('');
	let why = $state('');
	let saving = $state(false);

	const correction = $derived(
		correcting && /^-?\d+(\.\d+)?$/.test(correctAmount.trim()) ? correctAmount.trim() : null
	);
	const total = $derived(
		sum(data.items.filter((i) => ticked.includes(`${i.kind}:${i.id}`)).map((i) => i.amount)).add(
			correction ?? '0'
		)
	);
	const owedNow = $derived(sum(data.items.map((i) => i.amount)));

	async function record() {
		why = '';
		const picked = data.items.filter((i) => ticked.includes(`${i.kind}:${i.id}`));
		if (!picked.length && !correcting) return (why = 'Tick what it covers.');
		if (correcting && (!correctTo || !correction || !correctWhy.trim()))
			return (why = 'A correction needs the payment it corrects, an amount and why.');
		saving = true;
		const r = await fetch('/api/pay', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				client_uuid: clientUuid,
				user_id: data.person.id,
				paid_on: paidOn,
				how,
				note: note.trim() || null,
				entries: picked.filter((i) => i.kind === 'time').map((i) => i.id),
				trips: picked.filter((i) => i.kind === 'trip').map((i) => i.id),
				correction: correcting
					? { payment_id: correctTo, amount: correction, why: correctWhy.trim() }
					: null
			})
		}).catch(() => null);
		saving = false;
		if (!r) return (why = 'Not recorded — no connection.');
		if (!r.ok) {
			const p = await readProblem(r);
			return (why = Object.values(p.errors ?? {})[0] ?? p.detail ?? 'That was not recorded.');
		}
		const { id } = (await r.json()) as { id: string };
		await goto(resolve('/reports/pay/payments/[id]', { id }), { invalidateAll: true });
	}
</script>

<Top
	title="Pay {data.person.name}"
	sub={data.items.length ? `${money(owedNow.toString())} owed` : 'Nothing owed'}
	back={resolve('/reports/pay')}
	backLabel="Pay"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>What it covers</h2></div>
		<div class="rows">
			{#each data.items as i (i.kind + i.id)}
				{@const key = `${i.kind}:${i.id}`}
				{#if i.amount === null}
					<div class="rec warn">
						<div class="rec-m">
							<div class="rec-t">{i.place} · {day(i.day)}</div>
							<div class="rec-s">{i.said}</div>
						</div>
						<div class="rec-n"><span class="rec-v mut">—</span></div>
					</div>
				{:else}
					<label class="rec tickable">
						<input type="checkbox" checked={ticked.includes(key)} onchange={() => toggle(key)} />
						<div class="rec-m">
							<div class="rec-t">{i.place} · {day(i.day)}</div>
							<div class="rec-s">{i.said}</div>
						</div>
						<div class="rec-n"><span class="rec-v">{money(i.amount)}</span></div>
					</label>
				{/if}
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing owed</span></div>
						<div class="rec-s">Every piece of their work is in a payment</div>
					</div>
				</div>
			{/each}
			{#if data.payments.length}
				{#if correcting}
					<div class="rec acc">
						<div class="rec-m">
							<div class="rec-t">A correction</div>
							<div class="rec-s">{correctWhy || 'Why, below'}</div>
						</div>
						<div class="rec-n">
							<span class="rec-v">{correction ? money(correction) : '—'}</span>
						</div>
					</div>
				{:else}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t"><span class="lt">A correction</span></div>
							<div class="rec-s">To a payment already made, plus or minus, with why</div>
						</div>
						<div class="rec-n">
							<button type="button" class="btn sm" onclick={() => (correcting = true)}>Add</button>
						</div>
					</div>
				{/if}
			{/if}
			<div class="rec tot">
				<div class="rec-m"><div class="rec-t">This payment</div></div>
				<div class="rec-n"><span class="rec-v">{money(total.toString())}</span></div>
			</div>
		</div>
	</div>

	{#if correcting}
		<div class="sec">
			<div class="sec-h"><h2>The correction</h2></div>
			<div class="rows form">
				<div class="fld">
					<label for="c-to">To</label>
					<select id="c-to" class="inp" bind:value={correctTo}>
						{#each data.payments as p (p.id)}
							<option value={p.id}>{dated(p.paid_on)} · {money(p.total)} · {p.how}</option>
						{/each}
					</select>
				</div>
				<div class="duo">
					<div class="fld">
						<label for="c-amount">Amount</label>
						<input
							id="c-amount"
							class="inp"
							inputmode="decimal"
							placeholder="-19.00"
							bind:value={correctAmount}
						/>
					</div>
					<div class="fld">
						<label for="c-why">Why</label>
						<input id="c-why" class="inp" bind:value={correctWhy} />
					</div>
				</div>
				<button type="button" class="btn sm gho" onclick={() => (correcting = false)}
					>No correction</button
				>
			</div>
		</div>
	{/if}

	<div class="rows form">
		<div class="duo">
			<div class="fld">
				<label for="p-day">Paid on</label>
				<input id="p-day" class="inp" type="date" max={data.today} bind:value={paidOn} />
			</div>
			<div class="fld">
				<label for="p-how">How</label>
				<select id="p-how" class="inp" bind:value={how}>
					{#each HOW as h (h)}<option value={h}>{h}</option>{/each}
				</select>
			</div>
		</div>
		<div class="fld">
			<label for="p-note">Note</label>
			<input
				id="p-note"
				class="inp"
				placeholder="What it was for, as the bank says it"
				bind:value={note}
			/>
		</div>
		{#if why}<p class="why bad">{why}</p>{/if}
		<button class="btn pri blk" type="button" onclick={record} disabled={saving}
			>Record the payment</button
		>
		<p class="aside">
			reckon records the payment; it does not send money. Each item keeps what it pays now and the
			rule that set it, so a later change to a rule or a role moves only what is still owed.
		</p>
	</div>

	{#if data.payments.length}
		<div class="sec">
			<div class="sec-h"><h2>Paid before</h2></div>
			<div class="rows">
				{#each data.payments as p (p.id)}
					<a class="rec link" href={resolve('/reports/pay/payments/[id]', { id: p.id })}>
						<div class="rec-m">
							<div class="rec-t">{dated(p.paid_on)}</div>
							<div class="rec-s">
								{p.how} · {p.items}
								{p.items === 1 ? 'item' : 'items'}{p.note ? ` · ${p.note}` : ''}
							</div>
						</div>
						<div class="rec-n"><span class="rec-v">{money(p.total)}</span></div>
						<span class="arw" aria-hidden="true">›</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.form {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 15px;
	}
	.tickable {
		cursor: pointer;
		align-items: flex-start;
		gap: 12px;
	}
	.tickable input {
		margin-top: 4px;
		width: 18px;
		height: 18px;
		accent-color: var(--accent);
	}
	.lt {
		color: var(--ink-3);
	}
	.why {
		margin: 0;
	}
	.why.bad {
		color: var(--crit);
	}
	.aside {
		margin: 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}
</style>
