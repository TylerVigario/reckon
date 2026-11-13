<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import EntryForm from '#lib/EntryForm.svelte';
	import type { EntryFields } from '#lib/entry-form.ts';
	import { day, workedTimes } from '#lib/format.ts';
	import { readProblem } from '#lib/json.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * One time entry, changed after the fact (+page.server.ts): the Add past work
	 * form, filled in from it, saved over it (api/time/[id] PATCH), saying which
	 * save it began from so a change made meanwhile is not written over. Remove
	 * asks first. One on an invoice or in a payment says where, instead; one
	 * someone else entered says who changes it.
	 */
	let { data }: PageProps = $props();
	const field = untrack(() => data.user?.access === 'field');
	const e = $derived(data.entry);

	const when = $derived(
		e.started_at && e.ended_at && e.zone
			? `${day(e.worked_on)} · ${workedTimes(e.started_at, e.ended_at, e.zone, personalZone())}`
			: day(e.worked_on)
	);

	/** The first refusal a problem names, or what it says, or a plain no. */
	async function whyNot(r: Response | null) {
		if (!r) return 'This needs a connection. Nothing was changed.';
		const p = await readProblem(r);
		const first = p.errors ? Object.values(p.errors)[0] : undefined;
		return first ?? p.detail ?? 'That was not saved.';
	}

	async function save(entry: EntryFields) {
		const r = await fetch(`/api/time/${e.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...entry, version: e.version })
		}).catch(() => null);
		if (!r?.ok) return whyNot(r);
		await goto(resolve('/timesheet'));
		return null;
	}

	let removing = $state(false);
	let working = $state(false);
	let removeWhy = $state('');
	async function remove() {
		working = true;
		const r = await fetch(`/api/time/${e.id}`, { method: 'DELETE' }).catch(() => null);
		working = false;
		if (!r?.ok) {
			removing = false;
			removeWhy = await whyNot(r);
			return;
		}
		await goto(resolve('/timesheet'));
	}
</script>

<Top
	title={data.mayChange && !data.used && !data.paidTo ? 'Change an entry' : 'An entry'}
	sub="{when} · {e.service}"
	back={resolve('/timesheet')}
	backLabel="Time"
/>

<div class="pad">
	{#if data.used}
		<p class="why">
			This hour is on {data.used.draft ? 'draft' : 'invoice'}
			<a href={resolve('/invoices/[id]', { id: data.used.invoice })}
				>{data.used.number ?? 'a draft'}</a
			>, so it stays as it was billed.
			{data.used.draft
				? 'Take it off the draft to change it.'
				: 'Credit the invoice to correct it.'}
		</p>
	{:else if data.paidTo}
		<p class="why">
			This hour is in a payment to {data.paidTo}, so it stays as it was paid. A correction goes on
			their next payment.
		</p>
	{:else if !data.mayChange}
		<p class="why">
			Entered by {e.entered_by}. Whoever entered it, or someone with Full, changes it.
		</p>
	{:else}
		<EntryForm choices={data} {field} seed={e} saveLabel="Save changes" onsave={save}>
			{#snippet below()}
				{#if removeWhy}<p class="why bad" role="alert">{removeWhy}</p>{/if}
				<button class="btn gho blk" type="button" onclick={() => (removing = true)}
					>Remove this entry</button
				>
			{/snippet}
		</EntryForm>
	{/if}
</div>

<Dialog
	open={removing}
	title="Remove this entry?"
	go="Remove"
	going="Removing…"
	tone="danger"
	{working}
	ongo={remove}
	onclose={() => (removing = false)}
>
	<p>
		{when} · {e.service}. It is taken off the time, and the record of it is kept in its history.
	</p>
</Dialog>

<style>
	.why {
		margin: 0;
	}
	.why.bad {
		border-left-color: var(--crit);
		color: var(--crit);
	}
</style>
