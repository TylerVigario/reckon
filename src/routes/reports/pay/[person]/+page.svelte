<script lang="ts">
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { day, dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { sum } from '#lib/decimal.ts';
	import { PAID_AS_ORDER, PAID_AS_WORDS, type PaidAs } from '#lib/pay-words.ts';
	import type { PageProps } from './$types';
	/**
	 * Owed, the first of someone's pay tabs (+layout): what they are owed,
	 * piece by piece, a box for each kind of pay; and for someone with Full,
	 * what is ticked makes the payment, recorded in a dialog with the day, how
	 * and a note -- and a correction to one already made, where there is one.
	 * Someone with Field reads their own.
	 */
	let { data }: PageProps = $props();
	// Someone with Field opens only their own, to read (#lib/access).
	const field = $derived(data.user?.access === 'field');

	const HOW = ['Bank transfer', 'Cash', 'Check', 'Other'];
	// Made once, so a payment sent twice is one payment.
	const clientUuid = crypto.randomUUID();

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
	// "$149.25 guaranteed payments · $24.95 reimbursed"
	const totalSaid = $derived(
		groups
			.filter((as): as is PaidAs => as !== null)
			.map((as) => `${money(partOf(as).toString())} ${PAID_AS_WORDS[as].money}`)
			.join(' · ')
	);

	// A payment stands once recorded (0026), so it is recorded from a dialog
	// that says what it comes to and that it stands, and only one that could
	// be: what it lacks is said there.
	let recording = $state(false);
	function open() {
		why = '';
		recording = true;
	}

	async function record() {
		why = '';
		if (!picked.length && !correcting) return void (why = 'Tick what it covers first.');
		if (correcting && (!correctTo || !correctOf || !correction || !correctWhy.trim()))
			return void (why =
				'A correction needs the payment it corrects, which part, an amount and why.');
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
		if (!r) return void (why = 'Not recorded — no connection.');
		if (!r.ok) {
			const p = await readProblem(r);
			return void (why = Object.values(p.errors ?? {})[0] ?? p.detail ?? 'That was not recorded.');
		}
		const { id } = (await r.json()) as { id: string };
		await goto(resolve('/reports/pay/payments/[id]', { id }), { refreshAll: true });
	}
	// What each box is headed: the kind of pay, as its role says it.
	const heading = (as: PaidAs | 'reimbursement' | null) =>
		as === 'reimbursement'
			? 'For the vehicle'
			: as
				? PAID_AS_WORDS[as].heading
				: 'Paid as not said';
	const headingSub = (as: PaidAs | 'reimbursement' | null) =>
		as === 'reimbursement' ? 'a reimbursement' : null;
</script>

{#snippet item(i: (typeof data.items)[number])}
	<span class="what">
		<span class="n">{i.place} · {day(i.day)}</span>
		<span class="sub">{i.said}</span>
	</span>
	{#if i.amount === null}<span class="lab warn">No rule pays it</span>{/if}
	<span class="v" class:muted={i.amount === null}>{i.amount === null ? '—' : money(i.amount)}</span>
{/snippet}

{#each groups as as (as)}
	<section class="box" aria-labelledby="as-{as ?? 'none'}">
		<div class="box-h">
			<h2 class="box-t" id="as-{as ?? 'none'}">{heading(as)}</h2>
			{#if headingSub(as)}<span class="sub">{headingSub(as)}</span>{/if}
		</div>
		{#each data.items.filter((i) => i.paidAs === as) as i (i.kind + i.id)}
			{@const key = `${i.kind}:${i.id}`}
			{#if field || !payable(i)}
				<div class="box-row line">{@render item(i)}</div>
			{:else}
				<label class="box-row line tick">
					<input type="checkbox" checked={ticked.includes(key)} onchange={() => toggle(key)} />
					{@render item(i)}
				</label>
			{/if}
		{/each}
		{#if !field && as && correcting && correctOf === as}
			<div class="box-row line">
				<span class="what">
					<span class="n"
						>A correction to {dated(
							data.payments.find((p) => p.id === correctTo)?.paid_on ?? ''
						)}</span
					>
					<span class="sub">{correctWhy || 'Why, in the payment'}</span>
				</span>
				<span class="v">{correction ? money(correction) : '—'}</span>
			</div>
		{/if}
		{#if !field && as}
			<div class="box-row line tot">
				<span class="what"
					><span class="n">{as === 'reimbursement' ? 'Reimbursed' : PAID_AS_WORDS[as].heading}</span
					></span
				>
				<span class="v">{money(partOf(as).toString())}</span>
			</div>
		{:else if !as}
			<p class="box-row warn-row">
				{data.person.role
					? `${data.person.role} does not say what it is paid as. Say it on Team, under Roles, and this can be paid.`
					: 'They hold no role, so nothing says what their work is paid as. Give them one on Team, and this can be paid.'}
			</p>
		{/if}
	</section>
{:else}
	<section class="box" aria-label="Owed">
		<p class="box-row muted">
			Nothing owed. Every piece of {field ? 'your' : 'their'} work is in a payment.
		</p>
	</section>
{/each}

{#if field}
	<p class="note">
		What you are owed, worked out from your time and trips. A payment is recorded by someone with
		Full when it is made, and a figure that looks wrong is theirs to correct.
	</p>
{:else}
	<section class="box" aria-labelledby="pay-h">
		<div class="box-h"><h2 class="box-t" id="pay-h">This payment</h2></div>
		<div class="box-row line">
			<span class="what">
				<span class="n">What is ticked</span>
				{#if totalSaid}<span class="sub">{totalSaid}</span>{/if}
			</span>
			<span class="v">{money(total.toString())}</span>
		</div>
		<div class="box-row keep">
			<button type="button" class="btn pri" onclick={open}>Record payment</button>
		</div>
	</section>
	<p class="note">
		reckon records the payment; it does not send money. Each item keeps what it pays now, the rule
		that set it and what it was paid as, so a later change to a rule or a role moves only what is
		still owed.
	</p>

	<Dialog
		open={recording}
		title="Pay {data.person.name}"
		go="Record payment"
		going="Recording…"
		working={saving}
		ongo={record}
		onclose={() => (recording = false)}
	>
		<div class="form">
			<p class="sum">
				<span class="v">{money(total.toString())}</span>
				{#if totalSaid}<span class="sub">{totalSaid}</span>{/if}
			</p>
			<div class="fc">
				<label class="fc-l" for="p-day">Paid on</label>
				<input id="p-day" class="ti" type="date" max={data.today} bind:value={paidOn} />
			</div>
			<div class="fc">
				<label class="fc-l" for="p-how">How</label>
				<select id="p-how" class="ti" bind:value={how}>
					{#each HOW as h (h)}<option value={h}>{h}</option>{/each}
				</select>
			</div>
			<div class="fc">
				<label class="fc-l" for="p-note">Note</label>
				<input
					id="p-note"
					class="ti"
					autocomplete="off"
					placeholder="What it was for, as the bank says it"
					bind:value={note}
				/>
			</div>
			{#if data.payments.length}
				<label class="rad">
					<input type="checkbox" bind:checked={correcting} />
					<span>
						<span class="rad-t">With a correction</span>
						<span class="rad-c">To a payment already made, plus or minus, with why.</span>
					</span>
				</label>
			{/if}
			{#if correcting}
				<div class="fc">
					<label class="fc-l" for="c-to">To</label>
					<select id="c-to" class="ti" bind:value={correctTo} onchange={pickPayment}>
						{#each data.payments as p (p.id)}
							<option value={p.id}>{dated(p.paid_on)} · {money(p.total)} · {p.how}</option>
						{/each}
					</select>
				</div>
				<div class="fc">
					<label class="fc-l" for="c-of">Of</label>
					<select id="c-of" class="ti" bind:value={correctOf}>
						{#each parts as x (x.paid_as)}
							<option value={x.paid_as}>
								Its {x.paid_as === 'reimbursement'
									? 'reimbursement'
									: PAID_AS_WORDS[x.paid_as].money}, {money(x.total)}
							</option>
						{/each}
					</select>
				</div>
				<div class="fc">
					<label class="fc-l" for="c-amount">Amount</label>
					<input
						id="c-amount"
						class="ti"
						inputmode="decimal"
						autocomplete="off"
						placeholder="-19.00"
						bind:value={correctAmount}
					/>
				</div>
				<div class="fc">
					<label class="fc-l" for="c-why">Why</label>
					<input id="c-why" class="ti" autocomplete="off" bind:value={correctWhy} />
				</div>
			{/if}
			{#if why}<p class="fc-e"><Octicon name="alert" />{why}</p>{/if}
			<p class="fc-c">
				A payment stands once recorded. What it covers can no longer be changed or removed, and a
				mistake is put right by a correction on a later payment.
			</p>
		</div>
	</Dialog>
{/if}

<style>
	.line {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
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
		color: var(--fgColor-muted);
	}
	.lab {
		flex: 0 0 auto;
	}
	.v {
		flex: 0 0 auto;
		font-family: var(--fontStack-monospace);
		font-weight: 600;
		text-align: right;
	}
	.tick {
		cursor: pointer;
	}
	.tick input {
		flex: 0 0 auto;
		width: 16px;
		height: 16px;
		margin: 0;
		accent-color: var(--fgColor-accent);
	}
	.tot {
		background: var(--bgColor-muted);
	}
	.warn-row {
		margin: 0;
		color: var(--fgColor-attention);
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.sum {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.sum .v {
		font-size: 20px;
		text-align: left;
	}
</style>
