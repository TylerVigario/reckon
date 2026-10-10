<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import { day } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { changesHeld, flush, linesHeld } from '#lib/queue.ts';
	import type { PageProps } from './$types';
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
	let why = $state('');

	/**
	 * Sends it, then hands the link on: to the phone's share sheet, or to the
	 * clipboard. Either can be refused by the browser once the send has taken a
	 * moment, and then the invoice's own screen has the link to share again.
	 */
	async function send(hand: 'share' | 'copy') {
		why = '';
		sending = true;
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
		await goto(
			`${resolve('/invoices/[id]', { id: i.id })}${handed ? `?link=${handed}` : '?link=sent'}`,
			{ invalidateAll: true }
		);
	}
</script>

<Top
	title="Send {i.number}"
	sub={i.who}
	back={resolve('/invoices/[id]', { id: i.id })}
	backLabel={i.number}
/>

<div class="pad">
	<div class="tiles">
		<div class="tile">
			<span class="k">Due</span>
			<span class="v">{money(i.due)}</span>
			<span class="s"
				>{i.lines}
				{i.lines === 1 ? 'line' : 'lines'}{Number(i.tax) > 0
					? `, ${money(i.tax)} tax`
					: ', no tax'}</span
			>
		</div>
		<div class="tile">
			<span class="k">Dated</span>
			<span class="v sm">{day(data.today)}</span>
			<span class="s">due {day(data.due_on)} · net {i.terms}</span>
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>How it reaches them</h2></div>
		<div class="rows">
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">A link to the invoice</div>
					<div class="rec-s">They open it without signing in.</div>
				</div>
			</div>
			<div class="rec">
				<div class="rec-m">
					{#if c && (c.email || c.phone)}
						<div class="rec-t">{[c.email, c.phone].filter(Boolean).join(' · ')}</div>
						<div class="rec-s">{c.name}, from the client's record</div>
					{:else}
						<div class="rec-t"><span class="lt">No email or phone on their record</span></div>
						<div class="rec-s">The link can be sent however you reach them</div>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<div class="rows form">
		{#if held}
			<p class="why bad">
				{held === 1 ? 'Something' : `${held} things`} added or changed on this phone {held === 1
					? 'has'
					: 'have'} not reached the server. Send it once {held === 1 ? 'it has' : 'they have'}, so
				nothing is left off.
			</p>
		{:else if !online}
			<p class="why bad">Sending needs a connection.</p>
		{/if}
		{#if why}<p class="why bad">{why}</p>{/if}
		<button
			class="btn pri blk"
			type="button"
			disabled={sending || held > 0 || !online || i.lines === 0}
			onclick={() => send('share')}>Send — share the link</button
		>
		<button
			class="btn blk"
			type="button"
			disabled={sending || held > 0 || !online || i.lines === 0}
			onclick={() => send('copy')}>Copy the link</button
		>
		<p class="aside">
			Sharing opens your phone's share sheet: Messages, Mail. Once it is sent the invoice cannot
			change; a correction is a credit note.
		</p>
	</div>
</div>

<style>
	.form {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 18px;
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
