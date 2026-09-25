<script lang="ts">
	import Top from '$lib/Top.svelte';
	import { money } from '$lib/money.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const hours = (v: string | null) => (v === null ? '—' : `${Number(v).toFixed(2)} h`);

	/** Usage, read against what the allotment allows. */
	const usage = (m: {
		allotment: string;
		cap_hours: string | null;
		hours_used: string;
		hours_left: string | null;
	}) =>
		m.allotment === 'unlimited'
			? `${hours(m.hours_used)} used of unlimited`
			: m.allotment === 'capped'
				? `${hours(m.hours_used)} used of ${hours(m.cap_hours)} · ${hours(m.hours_left)} left`
				: `${hours(m.hours_used)} used, nothing included`;
</script>

<Top
	title="Retainer meter"
	sub="What each retainer covered, this month and last"
	back={resolve('/reports')}
	backLabel="Reports"
/>

<div class="pad">
	{#each data.months as mo (mo.period.start)}
		<div class="sec">
			<div class="sec-h"><h2>{mo.period.label}</h2></div>
			<div class="rows">
				{#each mo.rows as r (r.entity_id)}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t">{r.client}</div>
							{#each r.services as m (m.service)}
								<div class="rec-s">{m.service} · {usage(m)}</div>
							{:else}
								<div class="rec-s">The agreement names no service to meter</div>
							{/each}
							{#each r.responders as who (who.person)}
								<div class="rec-s">
									{who.person} · {hours(who.hours)}, {who.share}% of the covered time · {who.paid ===
									null
										? 'pay not known until the month is charged'
										: `${money(who.paid)} for it`}
								</div>
							{/each}
							<div class="rec-c">
								{#if r.services.some((m) => m.allotment === 'unlimited')}
									<span class="chip acc">∞</span>
								{/if}
								{#if r.retainer?.state === 'given'}
									<span class="chip good">given freely · {money(r.retainer.charge)} a month</span>
								{:else if r.retainer?.state === 'uncharged'}
									<span class="chip warn">retainer not charged yet</span>
								{/if}
							</div>
						</div>
						<div class="rec-n">
							<span class="rec-v" class:mut={Number(r.charged) === 0}>{money(r.charged)}</span>
							<span class="rec-x">
								{#if r.paid === null}
									pay not known yet
								{:else if Number(r.paid) > 0}
									{money(r.paid)} paid out
								{:else}
									all kept
								{/if}
							</span>
						</div>
					</div>
				{:else}
					<div class="rec">
						<div class="rec-m">
							<div class="rec-t"><span class="lt">Nothing to meter</span></div>
							<div class="rec-s">
								No retainer ran in {mo.period.label}
							</div>
						</div>
					</div>
				{/each}
				{#if mo.rows.length}
					<div class="rec tot">
						<div class="rec-m"><div class="rec-t">Retainers</div></div>
						<div class="rec-n">
							<span class="rec-v">{money(mo.charged)}</span>
							<span class="rec-x">
								{mo.kept === null ? 'what is kept is not known yet' : `${money(mo.kept)} kept`}
							</span>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/each}
</div>
