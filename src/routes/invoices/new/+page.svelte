<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import Top from '#lib/Top.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { onMount } from 'svelte';
	import { enqueueDraft, flush, waitingCount } from '#lib/queue.ts';
	import { warm } from '#lib/warm.ts';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
	let client = $state(untrack(() => data.client ?? data.clients[0]?.id ?? ''));
	let saving = $state(false);
	let why = $state('');
	let waiting = $state(0);
	onMount(() => {
		void waitingCount().then(
			(n) => (waiting = n),
			() => {}
		);
	});

	/**
	 * Starts the draft on this phone, then sends what is waiting. With a signal
	 * it arrives at once, numbered, and its own screen opens; without one, the
	 * screen for a draft on this phone does, and it takes its number later.
	 */
	async function start(e: SubmitEvent) {
		e.preventDefault();
		const who = data.clients.find((c) => c.id === client);
		if (!who) {
			why = 'Which client.';
			return;
		}
		saving = true;
		why = '';
		const uuid = crypto.randomUUID();
		try {
			await enqueueDraft({ client_uuid: uuid, entity_id: who.id, who: who.name });
		} catch {
			why = 'This phone would not save the draft, so it is not started.';
			saving = false;
			return;
		}
		// A few seconds for the server to take it; no longer.
		await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
		const r = await fetch(`/api/drafts?client_uuid=${encodeURIComponent(uuid)}`).catch(() => null);
		if (r?.ok) {
			const { id } = (await r.json()) as { id: string };
			// Started: the worker keeps it for no signal from now on.
			warm();
			await goto(resolve('/invoices/[id]', { id }));
		} else await goto(`${resolve('/invoices/on-phone')}?draft=${encodeURIComponent(uuid)}`);
	}
</script>

<Top
	title="New draft"
	sub="An invoice to add lines to"
	back={resolve('/invoices')}
	backLabel="Invoices"
/>

<OfflineBanner asOf={data.as_of} {waiting} />

<div class="pad">
	<form class="rows form" onsubmit={start}>
		<div class="fld">
			<label for="n-client">For</label>
			<select id="n-client" name="entity_id" class="inp" bind:value={client}>
				{#each data.clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
			{#if why}<small class="why">{why}</small>{/if}
			<small class="lt"
				>It takes the next invoice number when it reaches the server, and stays a draft until it is
				sent.</small
			>
		</div>
		<button class="btn pri blk" disabled={saving || !client}>
			{saving ? 'Starting…' : 'Start the draft'}
		</button>
	</form>
</div>

<style>
	.form {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 15px;
	}
	.why {
		color: var(--crit);
		font-size: 12.5px;
	}
	button.btn[disabled] {
		opacity: 0.6;
		cursor: default;
	}
</style>
