<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { day } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { changesHeld, flush, linesHeld } from '#lib/queue.ts';
	import type { PageProps } from './$types';
	import { busy } from '#lib/busy.svelte.ts';
	let { data }: PageProps = $props();

	const i = $derived(data.invoice);
	const c = $derived(data.contact);

	// What this phone still holds for this draft: it would be left off what is
	// sent, and start a draft of its own when it arrived. So it goes first.
	let held = $state(0);
	let online = $state(true);
	async function read() {
		try {
			const [lines, changes] = await Promise.all([linesHeld(), changesHeld(i.id)]);
			held =
				lines.filter((q) => !q.refused && [i.id, i.client_uuid].includes(q.line.invoice_id))
					.length + changes.length;
		} catch {
			held = 0;
		}
	}
	onMount(() => {
		online = navigator.onLine;
		void read().then(async () => {
			if (held) await flush().catch(() => null);
			await read();
		});
		const on = () => (online = true);
		const off = () => (online = false);
		addEventListener('online', on);
		addEventListener('offline', off);
		return () => {
			removeEventListener('online', on);
			removeEventListener('offline', off);
		};
	});

	let sending = $state(false);
	/** Which of the two was pressed: it spins, and the other waits. */
	let sendingBy = $state<'share' | 'copy' | null>(null);
	let why = $state('');

	/**
	 * Sends it, then hands the link on: to the phone's share sheet, or to the
	 * clipboard. Either can be refused by the browser once the send has taken a
	 * moment, and then the invoice's own screen has the link to share again.
	 */
	async function send(hand: 'share' | 'copy') {
		why = '';
		sending = true;
		sendingBy = hand;
		const r = await fetch(`/api/invoices/${i.id}/send`, { method: 'POST' }).catch(() => null);
		if (!r) {
			sending = false;
			return (why = 'Not sent — no connection.');
		}
		if (!r.ok) {
			sending = false;
			const p = await readProblem(r);
			return (why = Object.values(p.errors ?? {})[0] ?? p.detail ?? 'That was not sent.');
		}
		const { link } = (await r.json()) as { link: string };
		let handed = '';
		try {
			if (hand === 'share' && navigator.share) {
				await navigator.share({ title: `Invoice ${i.number}`, url: link });
				handed = 'shared';
			} else {
				await navigator.clipboard.writeText(link);
				handed = 'copied';
			}
		} catch {
			// Cancelled, or not allowed: it is sent either way.
		}
		await goto(resolve(`/invoices/[id]?link=${handed || 'sent'}`, { id: i.id }), {
			refreshAll: true
		});
	}
</script>

<Top
	title="Send {i.number}"
	sub={i.who}
	back={resolve('/invoices/[id]', { id: i.id })}
	backLabel={i.number}
/>

<div class="pad">
	<section class="box" aria-labelledby="goes-h">
		<div class="box-h"><h2 class="box-t" id="goes-h">What goes out</h2></div>
		<div class="box-row kv">
			<span class="kv-l">Due</span>
			<span class="kv-v">
				<span class="v">{money(i.due)}</span>
				<span class="kv-s"
					>{i.lines}
					{i.lines === 1 ? 'line' : 'lines'}{Number(i.tax) > 0
						? `, ${money(i.tax)} tax`
						: ', no tax'}</span
				>
			</span>
		</div>
		<div class="box-row kv">
			<span class="kv-l">Dated</span>
			<span class="kv-v">
				<span>{day(data.today)}</span>
				<span class="kv-s">due {day(data.due_on)} · net {i.terms}</span>
			</span>
		</div>
	</section>

	<section class="box" aria-labelledby="reach-h">
		<div class="box-h"><h2 class="box-t" id="reach-h">How it reaches them</h2></div>
		<div class="box-row kv">
			<span class="kv-l">A link</span>
			<span class="kv-v"><span>They open it without signing in.</span></span>
		</div>
		<div class="box-row kv">
			<span class="kv-l">To</span>
			<span class="kv-v">
				{#if c && (c.email || c.phone)}
					<span>{[c.email, c.phone].filter(Boolean).join(' · ')}</span>
					<span class="kv-s">{c.name}, from the client’s record</span>
				{:else}
					<span>No email or phone on their record</span>
					<span class="kv-s">The link can be sent however you reach them</span>
				{/if}
			</span>
		</div>
	</section>

	{#if held}
		<div class="banner warn" role="status">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t why bad">
					{held === 1 ? 'Something' : `${held} things`} added or changed on this phone {held === 1
						? 'has'
						: 'have'} not reached the server. Send it once {held === 1 ? 'it has' : 'they have'}, so
					nothing is left off.
				</p>
			</div>
		</div>
	{:else if !online}
		<div class="banner warn" role="status">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t why bad">Sending needs a connection.</p></div>
		</div>
	{/if}
	{#if why}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t why bad">{why}</p></div>
		</div>
	{/if}
	<div class="acts">
		<button
			class="btn pri"
			type="button"
			disabled={held > 0 || !online || i.lines === 0 || (sending && sendingBy !== 'share')}
			onclick={() => send('share')}
			{@attach busy(sending && sendingBy === 'share' && 'Sending the invoice')}
			>Send — share the link</button
		>
		<button
			class="btn"
			type="button"
			disabled={held > 0 || !online || i.lines === 0 || (sending && sendingBy !== 'copy')}
			onclick={() => send('copy')}
			{@attach busy(sending && sendingBy === 'copy' && 'Sending the invoice')}
			>Send — copy the link</button
		>
	</div>
	<p class="note">
		Sharing opens your phone’s share sheet: Messages, Mail. Once it is sent the invoice cannot
		change; a correction is a credit note.
	</p>
</div>

<style>
	.v {
		font-family: var(--fontStack-monospace);
		font-weight: 600;
		color: var(--fgColor-default);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
</style>
