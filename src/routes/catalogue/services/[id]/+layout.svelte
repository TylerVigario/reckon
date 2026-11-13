<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import RecordHead from '#lib/RecordHead.svelte';
	import { increment } from '#lib/format.ts';
	import { money, unitPrice } from '#lib/money.svelte.ts';
	import { readProblem } from '#lib/json.ts';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	/**
	 * A service, as Primer draws a record: its name heading it with its menu
	 * beside it, what it charges in a line under it, then its tabs, each its
	 * own address -- Prices, Pay, Details and History, the most used first
	 * (#lib/section-tabs). Retire, Offer again and Delete are in the menu, each
	 * asking first in a dialog: retiring reaches past the service, into the
	 * timer, the agreements and the trips that bill by it.
	 */
	let { data, children }: LayoutProps = $props();
	const s = $derived(data.service);
	const endpoint = $derived(`/api/services/${data.service.id}`);
	const per = $derived(s.unit === 'hour' ? 'an hour' : s.unit === 'mile' ? 'a mile' : 'each');

	let problem = $state('');
	let deleting = $state<'idle' | 'asking' | 'working'>('idle');
	let retiring = $state(false);
	let offering = $state(false);
	const unused = $derived(
		data.used.entries === 0 && data.used.legs === 0 && data.used.agreements === 0
	);
	const usedBy = $derived(
		[
			data.used.entries
				? `${data.used.entries} time ${data.used.entries === 1 ? 'entry' : 'entries'}`
				: null,
			data.used.legs ? `${data.used.legs} trip ${data.used.legs === 1 ? 'leg' : 'legs'}` : null,
			data.used.agreements
				? `${data.used.agreements} ${data.used.agreements === 1 ? 'agreement' : 'agreements'}`
				: null
		]
			.filter(Boolean)
			.join(', ')
	);

	async function setOffered(active: boolean) {
		offering = true;
		problem = '';
		const r = await fetch(endpoint, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { active: String(active) } })
		}).catch(() => null);
		offering = false;
		if (!r?.ok) {
			problem = r
				? ((await readProblem(r)).detail ?? 'That did not save.')
				: 'Not saved — no connection.';
			return;
		}
		await refreshAll();
	}

	async function remove() {
		deleting = 'working';
		problem = '';
		const r = await fetch(endpoint, { method: 'DELETE' }).catch(() => null);
		if (r?.ok) {
			await goto(resolve('/catalogue/services'));
			return;
		}
		deleting = 'idle';
		problem = r
			? ((await readProblem(r)).detail ?? 'It was not deleted.')
			: 'Not deleted — no connection.';
	}

	const menu = $derived(
		unused
			? [{ label: 'Delete', danger: true, onselect: (): void => void (deleting = 'asking') }]
			: s.active
				? [{ label: 'Retire', onselect: (): void => void (retiring = true) }]
				: [{ label: 'Offer again', onselect: (): void => void setOffered(true) }]
	);

	const tabs = $derived([
		{
			href: resolve('/catalogue/services/[id]', { id: s.id }),
			label: 'Prices',
			current: page.route.id === '/catalogue/services/[id]'
		},
		{
			href: resolve('/catalogue/services/[id]/pay', { id: s.id }),
			label: 'Pay',
			current: page.route.id === '/catalogue/services/[id]/pay'
		},
		{
			href: resolve('/catalogue/services/[id]/details', { id: s.id }),
			label: 'Details',
			current: page.route.id === '/catalogue/services/[id]/details'
		},
		{
			href: resolve('/catalogue/services/[id]/history', { id: s.id }),
			label: 'History',
			current: page.route.id === '/catalogue/services/[id]/history'
		}
	]);
</script>

<Top title={s.name} back={resolve('/catalogue/services')} backLabel="Services">
	{#snippet actions()}
		<ActionMenu label="Actions for {s.name}" items={menu} />
	{/snippet}
</Top>

<div class="pad primer">
	<RecordHead label="{s.name}’s record" {tabs}>
		{#snippet state()}
			{#if !s.active}<span class="lab warn">Retired</span>{/if}
			<span class="muted">
				{data.rate ? `${unitPrice(data.rate)} ${per}` : 'Not priced for every client'}{s.unit ===
				'hour'
					? ` · billed ${increment(s.bill_to_nearest_seconds)}`
					: s.unit === 'each'
						? ' · a flat charge each time'
						: ''}{s.minimum_charge ? ` · at least ${money(s.minimum_charge)}` : ''}
			</span>
		{/snippet}
	</RecordHead>

	{#if !s.active}
		<div class="banner warn" role="status">
			<Octicon name="alert" />
			<div class="banner-m">
				<p class="banner-t">Not offered for new work</p>
				<p class="banner-d">
					It stays under its name on everything it billed{usedBy ? `: ${usedBy}` : ''}. Offer it
					again, from its menu, to put it back as it was.
				</p>
			</div>
		</div>
	{/if}
	{#if problem}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{problem}</p></div>
		</div>
	{/if}

	{@render children()}
</div>

<Dialog
	open={deleting !== 'idle'}
	title="Delete {s.name}?"
	go="Delete"
	going="Deleting…"
	working={deleting === 'working'}
	tone="danger"
	ongo={remove}
	onclose={() => (deleting = 'idle')}
>
	<p>Its prices and pay rules go with it. This can’t be undone.</p>
</Dialog>

<Dialog
	open={retiring}
	title="Retire {s.name}?"
	go="Retire"
	going="Retiring…"
	working={offering}
	ongo={async () => {
		await setOffered(false);
		retiring = false;
	}}
	onclose={() => (retiring = false)}
>
	<p>
		It can no longer be chosen for new work or covered by an agreement{s.time_tracked
			? ', and it leaves the timer'
			: ''}. What it has billed keeps its name{usedBy ? `: ${usedBy}` : ''}.
	</p>
	{#if s.unit === 'mile'}
		<p>
			While it is retired, a trip that bills its miles as {s.name} is refused, including one still waiting
			to send from someone’s phone.
		</p>
	{/if}
	<p>Offer it again to put it back as it was.</p>
</Dialog>
