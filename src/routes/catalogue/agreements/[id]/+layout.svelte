<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import RecordHead from '#lib/RecordHead.svelte';
	import { dated } from '#lib/format.ts';
	import { money } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	/**
	 * An agreement, as Primer draws a record: its client heading it with its
	 * menu beside it, what it charges and this period in a line under it, then
	 * its tabs, each its own address -- Covers, Charged, Pay and Terms, the most
	 * used first (#lib/section-tabs). End, Carry on and Delete are in the menu,
	 * each asking first in a dialog.
	 */
	let { data, children }: LayoutProps = $props();
	const a = $derived(data.agreement);
	const endpoint = $derived(`/api/agreements/${data.agreement.id}`);
	const PERIOD: Record<string, string> = {
		weekly: 'week',
		monthly: 'month',
		quarterly: 'quarter',
		annually: 'year'
	};
	const period = $derived(PERIOD[a.billing_interval] ?? 'period');

	let problem = $state('');
	let asking = $state<'idle' | 'delete' | 'end' | 'carry'>('idle');
	let working = $state(false);
	let endOn = $state('');

	async function send(init: RequestInit, failed: string) {
		problem = '';
		working = true;
		const r = await fetch(endpoint, init).catch(() => null);
		working = false;
		if (!r) {
			problem = `${failed} — no connection.`;
			return false;
		}
		if (!r.ok) {
			const b = await readProblem(r);
			problem = b.detail ?? Object.values(b.errors ?? {})[0] ?? b.title ?? `${failed}.`;
			return false;
		}
		return true;
	}
	async function setEnd(value: string) {
		const ok = await send(
			{
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ fields: { ends_on: value } })
			},
			'Not saved'
		);
		asking = 'idle';
		if (ok) await refreshAll();
	}
	async function remove() {
		if (await send({ method: 'DELETE' }, 'Not deleted'))
			await goto(resolve('/catalogue/agreements'));
		else asking = 'idle';
	}

	const menu = $derived(
		data.charged === 0
			? [{ label: 'Delete', danger: true, onselect: (): void => void (asking = 'delete') }]
			: a.ends_on
				? [{ label: 'Carry on', onselect: (): void => void (asking = 'carry') }]
				: [
						{
							label: 'End',
							onselect: (): void => {
								endOn = data.today;
								asking = 'end';
							}
						}
					]
	);

	const tabs = $derived([
		{
			href: resolve('/catalogue/agreements/[id]', { id: a.id }),
			label: 'Covers',
			current: page.route.id === '/catalogue/agreements/[id]'
		},
		{
			href: resolve('/catalogue/agreements/[id]/charged', { id: a.id }),
			label: 'Charged',
			count: data.charged,
			current: page.route.id === '/catalogue/agreements/[id]/charged'
		},
		{
			href: resolve('/catalogue/agreements/[id]/pay', { id: a.id }),
			label: 'Pay',
			current: page.route.id === '/catalogue/agreements/[id]/pay'
		},
		{
			href: resolve('/catalogue/agreements/[id]/terms', { id: a.id }),
			label: 'Terms',
			current: page.route.id === '/catalogue/agreements/[id]/terms'
		}
	]);
</script>

<Top
	title={a.client}
	sub={a.site ?? 'The whole client'}
	back={resolve('/catalogue/agreements')}
	backLabel="Agreements"
>
	{#snippet actions()}
		<ActionMenu label="Actions for this agreement" items={menu} />
	{/snippet}
</Top>

<div class="pad primer">
	<RecordHead label="This agreement" {tabs}>
		{#snippet state()}
			{#if a.ended}<span class="lab">Ended</span>{:else if data.now?.given}<span class="lab good"
					>This {period} given freely</span
				>{/if}
			<span class="muted">
				{money(a.price)} a {period}, in advance · {a.ended
					? `ended ${dated(a.ends_on)}`
					: a.ends_on
						? `until ${dated(a.ends_on)}`
						: `since ${dated(a.starts_on)}`}{!a.ended && !data.now
					? ` · this ${period} not charged yet`
					: ''}
			</span>
		{/snippet}
	</RecordHead>

	{#if problem}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{problem}</p></div>
		</div>
	{/if}

	{@render children()}
</div>

<Dialog
	open={asking === 'delete'}
	title="Delete this agreement?"
	go="Delete"
	going="Deleting…"
	{working}
	tone="danger"
	ongo={remove}
	onclose={() => (asking = 'idle')}
>
	<p>
		The agreement for {a.site ? `${a.client} at ${a.site}` : a.client}, and what it covers. Nothing
		has been charged under it. This can’t be undone.
	</p>
</Dialog>

<Dialog
	open={asking === 'end'}
	title="End this agreement?"
	go="End it then"
	going="Ending…"
	{working}
	ongo={() => {
		if (endOn) void setEnd(endOn);
	}}
	onclose={() => (asking = 'idle')}
>
	<div class="fc">
		<label class="fc-l" for="a-end">Its last day</label>
		<input id="a-end" class="ti" type="date" min={a.starts_on} bind:value={endOn} />
		<p class="fc-c">Work after this day is billed by the hour.</p>
	</div>
</Dialog>

<Dialog
	open={asking === 'carry'}
	title="Carry it on past {dated(a.ends_on)}?"
	go="Carry it on"
	going="Carrying it on…"
	{working}
	ongo={() => setEnd('')}
	onclose={() => (asking = 'idle')}
>
	<p>
		Work after that day is covered by it again rather than billed by the hour. Ending it again means
		choosing the day again.
	</p>
</Dialog>
