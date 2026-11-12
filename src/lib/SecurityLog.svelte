<script lang="ts">
	import { clock, datedAt } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import type { LoggedEvent } from '#lib/server/security-log.ts';
	import type { ResolvedPathname } from '$app/types';

	/**
	 * A page of the security log (#lib/server/security-log), as Primer draws a
	 * list in a box: each event a row, what it was first, then what else it
	 * says, then when, who did it where that was someone else, and where from.
	 * A refusal is marked as one. Whom it was about leads the second line:
	 * `person` is whose log this is, so an event
	 * about someone else names them; without it, as on Team's, every event
	 * names whom it was about. Older events are a link to the next page, so
	 * each page is its own address: `older`, the page's own route resolved with
	 * the cursor the loader gave.
	 */
	let {
		events,
		older,
		person = null,
		empty
	}: {
		events: LoggedEvent[];
		older: ResolvedPathname | null;
		person?: string | null;
		empty: string;
	} = $props();

	const REFUSALS = new Set([
		'authn_login_fail',
		'excess_rate_limit_exceeded',
		'authn_link_refused',
		'authz_fail'
	]);

	const when = (iso: string) => `${datedAt(iso, personalZone())}, ${clock(iso, personalZone())}`;
	const whom = (e: LoggedEvent) =>
		person === null
			? (e.about?.name ?? 'Nobody reckon knows')
			: e.about && e.about.id !== person
				? e.about.name
				: null;
</script>

<section class="box" aria-label="Security log">
	{#if events.length === 0}
		<p class="box-row muted">{empty}</p>
	{/if}
	{#each events as e (e.id)}
		<div class="box-row ev">
			<div class="ev-what">
				{#if REFUSALS.has(e.name)}<span class="lab crit">Refused</span>{/if}
				<span class="ev-says">{e.says}</span>
			</div>
			{#if whom(e) || e.detail}
				<div class="ev-detail">{[whom(e), e.detail].filter(Boolean).join(' · ')}</div>
			{/if}
			<div class="ev-meta">
				<time datetime={e.at}>{when(e.at)}</time>
				{#if e.by}<span>by {e.by}</span>{/if}
				{#if e.address}<span class="ev-address">{e.address}</span>{/if}
				{#if e.from}<span>{e.from}</span>{/if}
			</div>
		</div>
	{/each}
	{#if older}
		<a class="box-row more" href={older}>Older events</a>
	{/if}
</section>

<style>
	.ev {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.ev-what {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.ev-detail {
		font-size: 14px;
		color: var(--ink-2);
	}
	.ev-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0 6px;
		font-size: 13px;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
	.ev-meta > * + *::before {
		content: '· ';
	}
	.ev-address {
		font-family: var(--f-mono);
		font-size: 12px;
	}
	.more {
		font-weight: 600;
	}
	.muted {
		color: var(--ink-3);
		margin: 0;
	}
</style>
