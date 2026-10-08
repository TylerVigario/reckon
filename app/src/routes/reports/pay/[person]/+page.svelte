<script lang="ts">
	import Top from '#lib/Top.svelte';
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { day, dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { sum } from '#lib/decimal.ts';
	import { PAID_AS_ORDER, PAID_AS_WORDS, type PaidAs } from '#lib/pay-words.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	const HOW = ['Bank transfer', 'Cash', 'Check', 'Other'];
	// Made once, so a payment sent twice is one payment.
	const clientUuid = crypto.randomUUID();
	const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

	// What can be paid: a figure, and what it pays. Everything that can starts
	// ticked; what no rule pays, or a role has not said what it pays, cannot be.
	const payable = (i: { amount: string | null; paidAs: PaidAs | null }) =>
		i.amount !== null && i.paidAs !== null;
	let ticked = $state<string[]>(
		untrack(() => data.items.filter(payable).map((i) => `${i.kind}:${i.id}`))
	);
	const toggle = (key: string) =>
		(ticked = ticked.includes(key) ? ticked.filter((k) => k !== key) : [...ticked, key]);
	let correcting = $state(false);
	let correctTo = $state(untrack(() => data.payments[0]?.id ?? ''));
	let correctOf = $state<string>(untrack(() => data.payments[0]?.parts[0]?.paid_as ?? ''));
	let correctAmount = $state('');
	let correctWhy = $state('');
	let paidOn = $state(untrack(() => data.today));
	let how = $state(HOW[0]);
	let note = $state('');
	let why = $state('');
	let saving = $state(false);

	// The parts of the payment being corrected: a correction is to one of them.
	const parts = $derived(data.payments.find((p) => p.id === correctTo)?.parts ?? []);
	const pickPayment = () => (correctOf = parts[0]?.paid_as ?? '');

	const correction = $derived(
		correcting && /^-?\d+(\.\d+)?$/.test(correctAmount.trim()) ? correctAmount.trim() : null
	);
	const picked = $derived(data.items.filter((i) => ticked.includes(`${i.kind}:${i.id}`)));
	// Each group's ticked items, and the correction where it is to that part.
	const partOf = (as: PaidAs) =>
		sum(picked.filter((i) => i.paidAs === as).map((i) => i.amount)).add(
			correcting && correctOf === as ? (correction ?? '0') : '0'
		);
	// The groups shown: every kind owed, the correction's, and the unsaid last.
	const groups = $derived([
		...PAID_AS_ORDER.filter(
			(as) => data.items.some((i) => i.paidAs === as) || (correcting && correctOf === as)
		),
		...(data.items.some((i) => i.paidAs === null) ? [null] : [])
	]);
	const total = $derived(sum(picked.map((i) => i.amount)).add(correction ?? '0'));
	const owedNow = $derived(sum(data.items.map((i) => i.amount)));
	// "$149.25 guaranteed payments · $24.95 reimbursed"
	const totalSaid = $derived(
		groups
			.filter((as): as is PaidAs => as !== null)
			.map((as) => `${money(partOf(as).toString())} ${PAID_AS_WORDS[as].money}`)
			.join(' · ')
	);
	const partsSaid = (ps: { paid_as: PaidAs; total: string }[]) =>
		ps.map((x) => `${money(x.total)} ${PAID_AS_WORDS[x.paid_as].money}`).join(', ');

	async function record() {
		why = '';
		if (!picked.length && !correcting) return (why = 'Tick what it covers.');
		if (correcting && (!correctTo || !correctOf || !correction || !correctWhy.trim()))
			return (why = 'A correction needs the payment it corrects, which part, an amount and why.');
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
					? {
							payment_id: correctTo,
							paid_as: correctOf,
							amount: correction,
							why: correctWhy.trim()
						}
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
	sub={[
		data.items.length ? `${money(owedNow.toString())} owed` : 'Nothing owed',
		data.person.role ? `as ${an(data.person.role)}` : null
	]
		.filter(Boolean)
		.join(' · ')}
	back={resolve('/reports/pay')}
	backLabel="Pay"
/>

<div class="pad">
	{#each groups as as (as)}
		<div class="sec">
			<div class="sec-h">
				<h2>
					{#if as === 'reimbursement'}For the vehicle
						<span class="lt">· a reimbursement</span>{:else if as}{PAID_AS_WORDS[as]
							.heading}{:else}Paid as — <span class="lt">not said</span>{/if}
				</h2>
			</div>
			<div class="rows">
				{#each data.items.filter((i) => i.paidAs === as) as i (i.kind + i.id)}
					{@const key = `${i.kind}:${i.id}`}
					{#if !payable(i)}
						<div class="rec warn">
							<div class="rec-m">
								<div class="rec-t">{i.place} · {day(i.day)}</div>
								<div class="rec-s">{i.said}</div>
							</div>
							<div class="rec-n">
								<span class="rec-v mut">{i.amount === null ? '—' : money(i.amount)}</span>
							</div>
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
				{/each}
				{#if as && correcting && correctOf === as}
					<div class="rec acc">
						<div class="rec-m">
							<div class="rec-t">
								A correction to {dated(
									data.payments.find((p) => p.id === correctTo)?.paid_on ?? ''
								)}
							</div>
							<div class="rec-s">{correctWhy || 'Why, below'}</div>
						</div>
						<div class="rec-n">
							<span class="rec-v">{correction ? money(correction) : '—'}</span>
						</div>
					</div>
				{/if}
				{#if as}
					<div class="rec sub">
						<div class="rec-m">
							<div class="rec-t">
								{as === 'reimbursement' ? 'Reimbursed' : PAID_AS_WORDS[as].heading}
							</div>
						</div>
						<div class="rec-n"><span class="rec-v">{money(partOf(as).toString())}</span></div>
					</div>
				{:else}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-s">
								{data.person.role
									? `${data.person.role} does not say what it is paid as.`
									: 'They hold no role, so nothing says what their work is paid as.'}
								Say it in Settings, under People and pay, and this can be paid.
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="sec">
			<div class="rows">
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing owed</span></div>
						<div class="rec-s">Every piece of their work is in a payment</div>
					</div>
				</div>
			</div>
		</div>
	{/each}

	<div class="rows">
		{#if data.payments.length && !correcting}
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
		<div class="rec tot">
			<div class="rec-m">
				<div class="rec-t">This payment</div>
				{#if totalSaid}<div class="rec-s">{totalSaid}</div>{/if}
			</div>
			<div class="rec-n"><span class="rec-v">{money(total.toString())}</span></div>
		</div>
	</div>

	{#if correcting}
		<div class="sec">
			<div class="sec-h"><h2>The correction</h2></div>
			<div class="rows form">
				<div class="duo">
					<div class="fld">
						<label for="c-to">To</label>
						<select id="c-to" class="inp" bind:value={correctTo} onchange={pickPayment}>
							{#each data.payments as p (p.id)}
								<option value={p.id}>{dated(p.paid_on)} · {money(p.total)} · {p.how}</option>
							{/each}
						</select>
					</div>
					<div class="fld">
						<label for="c-of">Of</label>
						<select id="c-of" class="inp" bind:value={correctOf}>
							{#each parts as x (x.paid_as)}
								<option value={x.paid_as}>
									Its {x.paid_as === 'reimbursement'
										? 'reimbursement'
										: PAID_AS_WORDS[x.paid_as].money}, {money(x.total)}
								</option>
							{/each}
						</select>
					</div>
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
			reckon records the payment; it does not send money. Each item keeps what it pays now, the rule
			that set it and what it was paid as, so a later change to a rule or a role moves only what is
			still owed.
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
								{[
									p.how,
									partsSaid(p.parts),
									`${p.items} ${p.items === 1 ? 'item' : 'items'}`,
									p.note
								]
									.filter(Boolean)
									.join(' · ')}
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
	.sub .rec-t,
	.sub .rec-v {
		font-weight: 600;
	}
	.lt {
		font-weight: 400;
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
	.sec + .rows,
	.rows + .sec,
	.rows + .rows {
		margin-top: 18px;
	}
</style>
