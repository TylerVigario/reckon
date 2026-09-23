<script lang="ts">
	import { onMount } from 'svelte';
	import Top from '$lib/Top.svelte';
	import { pending, flush } from '$lib/queue';
	import { running, drop, type Running } from '$lib/timers';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const hhmm = (m: number) =>
		`${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

	// Everything here that is happening NOW is the browser's: the timer, and
	// whatever is waiting to be posted. Both are read on mount rather than
	// loaded, because neither is the server's to know yet.
	let timers = $state<Running[]>([]);
	let queued = $state(0);
	let online = $state(true);
	let now = $state(Date.now());

	onMount(() => {
		const read = () => {
			timers = running();
			queued = pending();
			online = navigator.onLine;
			now = Date.now();
		};
		read();
		const t = setInterval(read, 1000);
		const back = () => void flush().then(read, read);
		addEventListener('online', back);
		addEventListener('offline', read);
		return () => {
			clearInterval(t);
			removeEventListener('online', back);
			removeEventListener('offline', read);
		};
	});

	const live = $derived(timers[0]);

	const nameOf = (list: { id: string; name: string }[], id: string | null) =>
		list.find((x) => x.id === id)?.name ?? null;

	const siteOf = (entityId: string | null, siteId: string | null) => {
		const e = data.entities.find((x) => x.id === entityId);
		return e?.sites.find((s) => s.id === siteId)?.label ?? null;
	};

	const svc = $derived(live ? data.services.find((s) => s.id === live.service_id) : undefined);

	const clock = (t: Running) => {
		const s = Math.max(0, Math.floor((now - t.started_at) / 1000));
		const hm = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
		return { hm, ss: String(s % 60).padStart(2, '0') };
	};

	const startedAt = (t: Running) =>
		new Date(t.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

	const sub = $derived(
		[queued ? `${queued} queued` : null, `${Math.round(data.monthMinutes / 60)} h this month`]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<Top title="Time" {sub}>
	{#snippet actions()}
		<a class="btn sm" href={resolve('/timesheet/manual')}>Add past work</a>
	{/snippet}
</Top>

{#if queued > 0 || !online}
	<div class="offline">
		<span aria-hidden="true">●</span>
		{#if !online}Offline — {queued} {queued === 1 ? 'entry' : 'entries'} queued
		{:else}{queued} {queued === 1 ? 'entry' : 'entries'} waiting to send{/if}
	</div>
{/if}

<div class="pad">
	{#if live}
		{@const c = clock(live)}
		<div class="timer-card">
			<div>
				<div class="timer">{c.hm}<small>:{c.ss}</small></div>
				<div class="rec-s" style="margin-top: 5px">
					Started {startedAt(live)} · billing to the minute
				</div>
			</div>
			<div class="chips">
				{#if svc?.delivery}
					<span class="chip acc">
						<span class="dot"></span>{svc.delivery === 'remote' ? 'Remote' : 'On site'}
					</span>
				{/if}
				<span class="chip">{live.billable ? 'Billable' : 'Non-billable'}</span>
				<span class="chip">
					{live.crew === 'team'
						? 'Both of you'
						: (nameOf(data.people, live.worked_by) ?? 'Unassigned')}
				</span>
			</div>
			<div class="hr"></div>
			<div class="stack">
				<div class="kv">
					<span class="k">Entity</span>
					<span class="v">{nameOf(data.entities, live.entity_id) ?? '—'}</span>
				</div>
				<div class="kv">
					<span class="k">Location</span>
					<span class="v">{siteOf(live.entity_id, live.site_id) ?? '—'}</span>
				</div>
				<div class="kv">
					<span class="k">Service</span><span class="v">{svc?.name ?? '—'}</span>
				</div>
				<div class="kv">
					<span class="k">Rate</span>
					<span class="v">
						{#if svc?.rate}{money(svc.rate)}/h · {live.crew === 'team'
								? 'both on site'
								: 'one on site'}
						{:else}not priced{/if}
					</span>
				</div>
			</div>
			<div class="btnrow">
				<button class="btn pri blk" onclick={() => (timers = drop(live.id))}>Stop</button>
				<a class="btn" href={resolve('/timesheet/start')}>Start another</a>
			</div>
		</div>
	{:else}
		<div class="timer-card">
			<div>
				<div class="timer">0:00<small>:00</small></div>
				<div class="rec-s" style="margin-top: 5px">Nothing running</div>
			</div>
			<div class="btnrow">
				<a class="btn pri blk" href={resolve('/timesheet/start')}>Start a timer</a>
			</div>
		</div>
	{/if}

	<div class="sec">
		<div class="sec-h">
			<h2>Today</h2>
			<a class="seeall" href={resolve('/timesheet/all')}>All entries</a>
		</div>
		<div class="rows">
			{#each timers as t (t.id)}
				{@const c = clock(t)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">
							{siteOf(t.entity_id, t.site_id) ?? nameOf(data.entities, t.entity_id) ?? 'No client'}
							<span class="lt">· {t.crew === 'team' ? 'both' : 'running'}</span>
						</div>
						<div class="rec-s">
							{nameOf(data.people, t.worked_by) ?? 'Unassigned'} · running since {startedAt(t)}
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v">{c.hm}</span><span class="rec-x">running</span>
					</div>
				</div>
			{/each}

			{#each data.entries as e (e.id)}
				<div class="rec" class:gone={!e.billable}>
					<div class="rec-m">
						<div class="rec-t">
							{e.site ?? e.entity ?? e.note ?? 'No client'}
							<span class="lt">
								· {e.billable ? (e.delivery === 'remote' ? 'remote' : 'on site') : 'non-billable'}
							</span>
						</div>
						<div class="rec-s">
							{e.crew === 'team' ? 'Both of you' : (e.worked_by ?? 'Unassigned')} · {e.at} · {e.service}
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-v" class:mut={!e.billable}>{hhmm(e.minutes)}</span>
						<span class="rec-x">{e.invoiced ? 'billed' : 'unbilled'}</span>
					</div>
				</div>
			{/each}

			{#if timers.length === 0 && data.entries.length === 0}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing captured today</span></div>
						<div class="rec-s">A timer, or an entry by hand for work already done</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
