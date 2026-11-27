<script lang="ts">
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import {
		QUEUE_CHANGED,
		changesHeld,
		discardChange,
		discardLine,
		draftsHeld,
		enqueueChange,
		flush,
		linesHeld,
		notKept,
		waitingCount,
		type ChangeEntry,
		type QueuedChange,
		type QueuedDraft,
		type QueuedLine,
		type ShownDraft
	} from '#lib/queue.ts';
	import { clock, count, day } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { money } from '#lib/money.svelte.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { opens } from '#lib/access.ts';

	let { data }: PageProps = $props();

	const months = (d: number) => (d >= 60 ? count(Math.round(d / 30), 'month') : count(d, 'day'));

	const who = $derived(data.operator?.short_name || 'you');
	// Someone with Field adds lines to drafts, and starts and sends none (#lib/access).
	const field = $derived(data.user?.access === 'field');
	// The copy kept for no signal is the drafts alone (#lib/offline-copy).
	const sub = $derived(
		field || !data.totals
			? `${data.drafts.length} ${data.drafts.length === 1 ? 'draft' : 'drafts'} to add to`
			: `${money(data.totals.owed)} out · ${money(data.totals.drafted)} in draft`
	);

	// What is on this phone, waiting to send or refused: drafts started here,
	// lines by the draft they are for -- its id, or the uuid it was started with
	// on a phone -- changes to lines the server has, and everything for the
	// banner. The server cannot know them yet. Read again whenever the queue
	// sends, or something is kept or let go.
	let held = $state<QueuedLine[]>([]);
	let changes = $state<QueuedChange[]>([]);
	let started = $state<QueuedDraft[]>([]);
	let waiting = $state(0);
	async function read() {
		try {
			[held, changes, started, waiting] = await Promise.all([
				linesHeld(),
				changesHeld(),
				draftsHeld(),
				waitingCount()
			]);
		} catch {
			/* a phone that will not open its queue shows the server's drafts alone */
		}
	}
	onMount(() => {
		void read();
		const again = () => void read();
		addEventListener(QUEUE_CHANGED, again);
		return () => removeEventListener(QUEUE_CHANGED, again);
	});
	const onPhone = $derived.by(() => {
		const by: Record<string, number> = {};
		for (const q of held) by[q.line.invoice_id] = (by[q.line.invoice_id] ?? 0) + 1;
		return by;
	});
	const lines = (i: { id: string; client_uuid: string | null }) =>
		(onPhone[i.id] ?? 0) + (i.client_uuid ? (onPhone[i.client_uuid] ?? 0) : 0);

	// NOT ADDED: what is on this phone for a draft not listed here -- one that
	// has gone out, as a rule. Its own page does not open for someone with Field
	// (#lib/access), so this is where each is seen, for which draft and client,
	// as the phone kept them when it was made. A line refused for it is fixed,
	// to go on the client's next draft, or let go; one fixed waits here until it
	// goes. A change refused for one of its lines is let go -- the line is as it
	// was sent -- or, where the line was taken off meanwhile, put back with it,
	// which goes on the client's next draft too.
	const listed = $derived(
		new Set([
			...data.drafts.flatMap((d) => (d.client_uuid ? [d.id, d.client_uuid] : [d.id])),
			...started.map((q) => q.draft.client_uuid)
		])
	);
	const strayLines = $derived(held.filter((q) => !listed.has(q.line.invoice_id)));
	const strayChanges = $derived(
		changes.filter((q) => q.refused && !listed.has(q.change.invoice_id))
	);
	const named = (d: ShownDraft) => `${d.number ?? 'A draft started on this phone'} · ${d.who}`;
	const DONE: Record<ChangeEntry['act'], string> = {
		change: 'Changed on this phone',
		remove: 'Taken off on this phone',
		restore: 'Put back on this phone'
	};

	// Letting go of a refused line is it gone for good, so it takes a second
	// tap, and the first one says so.
	let confirming = $state<string | null>(null);
	async function letGo(id: string) {
		if (confirming !== id) {
			confirming = id;
			setTimeout(() => {
				if (confirming === id) confirming = null;
			}, 4000);
			return;
		}
		confirming = null;
		await discardLine(id).catch(() => {});
	}
	async function letChangeGo(q: QueuedChange) {
		await discardChange(q.change.line_id).catch(() => {});
	}
	let stored = $state('');
	async function restore(q: QueuedChange) {
		// A plain copy: what is kept in state is a proxy, which the phone's
		// database cannot store.
		try {
			await enqueueChange({ ...$state.snapshot(q.change), act: 'restore' }, true);
		} catch (e) {
			stored = notKept(e, 'This phone would not save that, so the line is not put back yet.');
			return;
		}
		const sent = await flush().catch(() => null);
		if (sent && sent.sent > 0) await refreshAll();
	}
</script>

<Top title="Invoices" {sub}>
	{#snippet actions()}
		{#if !field}<a class="btn sm" href={resolve('/invoices/new')}>New draft</a>{/if}
	{/snippet}
</Top>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	{#if stored}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t why">{stored}</p></div>
		</div>
	{/if}

	{#if !field && data.totals && data.totals.overdueCount > 0}
		<div class="state">
			<span class="lab crit">
				{money(data.totals.overdue)} overdue on {data.totals.overdueCount}
				{data.totals.overdueCount === 1 ? 'invoice' : 'invoices'}
			</span>
		</div>
	{/if}

	{#if strayLines.length || strayChanges.length}
		<section class="box" aria-labelledby="kept-h">
			<div class="box-h"><h2 class="box-t" id="kept-h">Not added</h2></div>
			{#each strayLines as q (q.line.client_uuid)}
				{@const l = q.line.shown}
				<div class="box-row held">
					<span class="n">{l.description}</span>
					<span class="sub">{named(q.line.draft)}</span>
					<span class="sub">{l.detail} · {money(l.amount)}</span>
					{#if !q.refused}
						<span class="labs"><span class="lab acc">Waiting to send</span></span>
						<p class="said">
							It goes on {q.line.draft.who}’s next draft when it reaches the server.
						</p>
					{:else if q.refused.status === 404}
						<!-- Its draft is gone: there is no client to put it with. -->
						<p class="refusal">
							Refused: {q.refused.detail} It is kept on this phone until it is let go.
						</p>
						<div class="acts">
							<button class="btn sm" onclick={() => letGo(q.line.client_uuid)}>
								{confirming === q.line.client_uuid ? 'Tap again to discard' : 'Discard'}
							</button>
						</div>
					{:else}
						<p class="refusal">
							Refused: {q.refused.detail} Fixed, it goes on {q.line.draft.who}’s next draft.
						</p>
						<div class="acts">
							<a
								class="btn sm pri"
								href={resolve(
									`/invoices/on-phone/add?fix=${encodeURIComponent(q.line.client_uuid)}`
								)}>Fix</a
							>
							<button class="btn sm" onclick={() => letGo(q.line.client_uuid)}>
								{confirming === q.line.client_uuid ? 'Tap again to discard' : 'Discard'}
							</button>
						</div>
					{/if}
				</div>
			{/each}
			{#each strayChanges as q (q.change.line_id)}
				{@const gone = q.refused?.conflict}
				<div class="box-row held">
					<span class="n">{q.change.shown.description}</span>
					<span class="sub">{named(q.change.draft)}</span>
					<span class="sub">{DONE[q.change.act]}</span>
					{#if gone?.what === 'removed'}
						<p class="refusal">
							{gone.by ?? 'Someone'} took it off at {clock(gone.at, personalZone())}. Your change to
							it waits on this phone. Put back, it goes on {q.change.draft.who}’s next draft.
						</p>
						<div class="acts">
							<button class="btn sm pri" onclick={() => restore(q)}
								>Put it back, with your change</button
							>
							<button class="btn sm" onclick={() => letChangeGo(q)}>Let your change go</button>
						</div>
					{:else}
						<p class="refusal">Refused: {q.refused?.detail}</p>
						<div class="acts">
							<button class="btn sm" onclick={() => letChangeGo(q)}>Let your change go</button>
						</div>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	{#if data.drafts.length || started.length}
		<section class="box" aria-labelledby="drafts-h">
			<div class="box-h">
				<h2 class="box-t" id="drafts-h">Drafts</h2>
				{#if opens(data.user?.access, '/invoices/ready')}
					<a class="lk" href={resolve('/invoices/ready')}>All {data.drafts.length}</a>
				{/if}
			</div>
			{#each started as q (q.draft.client_uuid)}
				<a
					class="box-row line"
					href={resolve(`/invoices/on-phone?draft=${encodeURIComponent(q.draft.client_uuid)}`)}
				>
					<span class="what">
						<span class="n">New draft · {q.draft.who}</span>
						<span class="sub" class:bad={q.refused}>
							{q.refused
								? `Refused: ${q.refused.detail}`
								: 'Takes its number when it reaches the server'}
						</span>
						<span class="labs">
							<span class="lab acc">On this phone</span>
							{#if onPhone[q.draft.client_uuid]}
								<span class="lab"
									>{onPhone[q.draft.client_uuid]}
									{onPhone[q.draft.client_uuid] === 1 ? 'line' : 'lines'}</span
								>
							{/if}
						</span>
					</span>
				</a>
			{/each}
			{#each data.drafts as i (i.id)}
				<a class="box-row line" href={resolve('/invoices/[id]', { id: i.id })}>
					<span class="what">
						<span class="n">{i.number} · {i.who}</span>
						<span class="sub">{i.kinds ?? 'no lines yet'}</span>
						{#if lines(i)}
							<span class="labs"><span class="lab acc">{lines(i)} on this phone</span></span>
						{/if}
					</span>
					{#if i.gross !== null}<span class="v">{money(i.gross)}</span>{/if}
				</a>
			{/each}
		</section>
	{/if}

	{#if data.out.length}
		<section class="box" aria-labelledby="out-h">
			<div class="box-h"><h2 class="box-t" id="out-h">Out, unpaid</h2></div>
			{#each data.out as i (i.id)}
				<a class="box-row line" href={resolve('/invoices/[id]', { id: i.id })}>
					<span class="what">
						<span class="n">{i.number} · {i.who}</span>
						<span class="sub">Sent {day(i.sent_on)}{i.terms ? ` · net ${i.terms}` : ''}</span>
						{#if i.overdue && i.days_out}
							<span class="labs"><span class="lab crit">Overdue · {months(i.days_out)}</span></span>
						{/if}
					</span>
					<span class="fig">
						<span class="v">{money(i.owed)}</span>
						{#if i.owed !== i.gross}<span class="sub">of {money(i.gross)}</span>{/if}
					</span>
				</a>
			{/each}
			<div class="box-row line tot">
				<span class="what"><span class="n">Owed to {who}</span></span>
				<span class="v">{money(data.totals?.owed)}</span>
			</div>
		</section>
	{/if}

	{#if data.paid.length}
		<section class="box" aria-labelledby="paid-h">
			<div class="box-h"><h2 class="box-t" id="paid-h">Paid, recently</h2></div>
			{#each data.paid as i (i.id)}
				<a class="box-row line" href={resolve('/invoices/[id]', { id: i.id })}>
					<span class="what">
						<span class="n">{i.number} · {i.who}</span>
						<span class="sub">Paid {day(i.paid_on)}</span>
					</span>
					<span class="v muted">{money(i.gross)}</span>
				</a>
			{/each}
		</section>
	{/if}

	{#if data.offline && !field}
		<p class="note">
			What has gone out or been paid, and what any of it comes to, needs a connection.
		</p>
	{/if}
	{#if field}
		<p class="note">
			Add what was used on the job to its client's draft. Someone with Full starts a draft and sends
			it, and once it has gone out it leaves this list.
		</p>
	{:else if !data.offline && data.drafts.length === 0 && data.out.length === 0 && data.paid.length === 0}
		<p class="note">No invoices yet.</p>
	{/if}
</div>

<style>
	.state {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
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
	.sub.bad {
		color: var(--fgColor-danger);
	}
	.labs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}
	.fig {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}
	.v {
		flex: 0 0 auto;
		font-family: var(--fontStack-monospace);
		font-weight: 600;
	}
	.tot {
		background: var(--bgColor-muted);
	}
	.held {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		overflow-wrap: anywhere;
	}
	.refusal,
	.said {
		margin: 0;
	}
	.refusal {
		color: var(--fgColor-danger);
	}
	.said {
		color: var(--fgColor-muted);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 6px;
	}
</style>
