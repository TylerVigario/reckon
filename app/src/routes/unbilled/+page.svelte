<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { day } from '$lib/format';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const place = (d: string | null) =>
		d === 'remote' ? 'remote' : d === 'on_site' ? 'on site' : '';

	// Who was there. A one-person entry names them; a team entry names the team,
	// because the entry itself deliberately does not.
	const worked = (crew: string, by: string | null) =>
		crew === 'team' ? data.team.join(' and ') : (by ?? 'nobody recorded');

	type Row = {
		key: string;
		href: string | null;
		title: string;
		aside: string;
		detail: string;
		worth: string | null;
		measure: string;
		days: number;
	};

	// Time and mileage in one list, oldest first, because age is the only thing
	// that decides which to chase and it does not care which kind it is.
	const rows = $derived<Row[]>(
		[
			...data.work.map((w) => ({
				key: `t${w.id}`,
				href: null,
				title: w.who,
				aside: place(w.delivery),
				detail: [worked(w.crew, w.worked_by), day(w.worked_on), w.site ?? 'no address on file']
					.filter(Boolean)
					.join(' · '),
				worth: w.worth,
				measure: `${Number(w.hours).toFixed(4)} h${w.crew === 'team' ? ' ×2' : ''}`,
				days: w.days
			})),
			...data.mileage.map((m) => ({
				key: `m${m.travelled_on}`,
				href: '/trips',
				title: 'Mileage',
				aside: `${m.trips} ${m.trips === 1 ? 'trip' : 'trips'}`,
				detail: [day(m.travelled_on), m.places ? `legs assigned across ${m.places}` : null]
					.filter(Boolean)
					.join(' · '),
				worth: m.worth,
				measure: `${Number(m.miles).toFixed(1)} mi`,
				days: m.days
			}))
		].sort((a, b) => b.days - a.days)
	);

	const sub = $derived(`${money(data.total)} worked, not yet sent`);
</script>

<Top title="Unbilled work" {sub} back={resolve('/')} backLabel="Today" />

<div class="pad">
	<div class="sec">
		<div class="sec-h">
			<h2>Oldest first</h2>
			<span class="sp"></span>
			{#if data.overdue}
				<span class="chip warn">
					<span class="dot"></span>{data.overdue} past {data.alertDays} days
				</span>
			{:else}
				<span class="chip">Nothing past {data.alertDays} days</span>
			{/if}
		</div>
		<div class="rows">
			{#each rows as r (r.key)}
				<svelte:element
					this={r.href ? 'a' : 'div'}
					class="rec"
					class:link={r.href}
					class:warn={r.days > data.alertDays}
					href={r.href}
				>
					<div class="rec-m">
						<div class="rec-t">
							{r.title}{#if r.aside}&nbsp;<span class="lt">· {r.aside}</span>{/if}
						</div>
						<div class="rec-s">{r.detail}</div>
					</div>
					<div class="rec-n">
						<span class="rec-v">{money(r.worth)}</span>
						<span class="rec-x">{r.measure} · {r.days} d</span>
					</div>
					{#if r.href}<span class="arw" aria-hidden="true">›</span>{/if}
				</svelte:element>
			{:else}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t"><span class="lt">Nothing waiting</span></div>
						<div class="rec-s">Everything worked has been put on an invoice</div>
					</div>
				</div>
			{/each}
			{#if rows.length}
				<div class="rec tot">
					<div class="rec-m"><div class="rec-t">Worked, not yet billed</div></div>
					<div class="rec-n"><span class="rec-v">{money(data.total)}</span></div>
				</div>
			{/if}
		</div>
	</div>

	{#if data.given.length}
		<div class="sec">
			<div class="sec-h"><h2>Not billable, and counted anyway</h2></div>
			<div class="rows">
				{#each data.given as g (g.id)}
					<div class="rec gone">
						<div class="rec-m">
							<div class="rec-t">
								{g.service}{#if g.who}&nbsp;<span class="lt">· {g.who}</span>{/if}
							</div>
							<div class="rec-s">
								{[
									worked('one', g.worked_by),
									day(g.worked_on),
									[g.site, place(g.delivery)].filter(Boolean).join(', ')
								]
									.filter(Boolean)
									.join(' · ')}
							</div>
						</div>
						<div class="rec-n">
							<span class="rec-v mut">—</span>
							<span class="rec-x">{Number(g.hours).toFixed(4)} h</span>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
