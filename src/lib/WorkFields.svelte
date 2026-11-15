<script lang="ts">
	import type { Snippet } from 'svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { pct } from '#lib/format.ts';
	import { unitPrice } from '#lib/money.svelte.ts';
	import { rateFor } from '#lib/rates.ts';
	import type { EntryChoices } from '#lib/entry-form.ts';

	/**
	 * What a piece of work is, as a timer is started (`now`) and an entry is
	 * entered or changed: who pays, where, what, who is on it, whether it is
	 * billed, and the note the invoice carries. Primer's form controls, each
	 * with its caption, or the error it was refused for, under it. The screen
	 * holding it asks when (`when`, drawn after who), checks and saves.
	 */
	let {
		choices,
		field,
		now = false,
		id,
		errors,
		entityId = $bindable(),
		siteId = $bindable(),
		serviceId = $bindable(),
		crew = $bindable(),
		workedBy = $bindable(),
		crewIds = $bindable(),
		billable = $bindable(),
		note = $bindable(),
		when
	}: {
		choices: Omit<EntryChoices, 'today'>;
		/** Someone with Field puts down only work they are on: their own, or a team's with them on it. */
		field: boolean;
		now?: boolean;
		/** What the fields' ids start with, so two forms never share one. */
		id: string;
		errors: Record<string, string>;
		entityId: string | null;
		siteId: string | null;
		serviceId: string | null;
		crew: 'one' | 'team';
		workedBy: string | null;
		crewIds: string[];
		billable: boolean;
		note: string;
		when?: Snippet;
	} = $props();

	const sites = $derived(choices.entities.find((e) => e.id === entityId)?.sites ?? []);
	const site = $derived(sites.find((s) => s.id === siteId));
	const service = $derived(choices.services.find((s) => s.id === serviceId));
	const heads = $derived(crew === 'team' ? crewIds.length : 1);
	const rate = $derived(rateFor(choices.prices, serviceId, entityId, heads));
	const per = (unit: string | undefined) =>
		unit === 'hour' ? 'an hour' : unit === 'mile' ? 'a mile' : `a ${unit ?? 'unit'}`;
	const me = $derived(choices.people.find((p) => p.id === choices.me));
	const others = $derived(
		field ? choices.people.filter((p) => p.id !== choices.me) : choices.people
	);
	const toggle = (who: string) =>
		(crewIds = crewIds.includes(who) ? crewIds.filter((x) => x !== who) : [...crewIds, who]);
	// The one person picked, or a team: one radio group, as Primer asks of a
	// choice a form saves.
	const who = $derived(crew === 'team' ? 'team' : (workedBy ?? ''));
	function pickWho(v: string) {
		if (v === 'team') crew = 'team';
		else {
			crew = 'one';
			workedBy = v;
		}
	}
	const described = (key: string, caption: boolean) =>
		[errors[key] ? `${id}-${key}-e` : null, caption ? `${id}-${key}-c` : null]
			.filter(Boolean)
			.join(' ') || undefined;
</script>

{#snippet wrong(key: string)}
	{#if errors[key]}<p class="fc-e" id="{id}-{key}-e"><Octicon name="alert" />{errors[key]}</p>{/if}
{/snippet}

<div class="fc">
	<label class="fc-l" for="{id}-entity">Who pays</label>
	<select
		id="{id}-entity"
		class="ti"
		bind:value={entityId}
		onchange={() => (siteId = null)}
		aria-invalid={errors.entity_id ? 'true' : undefined}
		aria-describedby={described('entity_id', false)}
	>
		<option value={null}>Nobody</option>
		{#each choices.entities as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
	</select>
	{@render wrong('entity_id')}
</div>

<div class="fc">
	<label class="fc-l" for="{id}-site">Where</label>
	<select
		id="{id}-site"
		class="ti"
		bind:value={siteId}
		disabled={!entityId}
		aria-describedby={site?.rate_pct ? `${id}-site-c` : undefined}
	>
		<option value={null}>{entityId ? 'Not at one of their sites' : 'Pick who pays first'}</option>
		{#each sites as st (st.id)}<option value={st.id}>{st.label}</option>{/each}
	</select>
	{#if site?.rate_pct}<p class="fc-c" id="{id}-site-c">Taxed there at {pct(site.rate_pct)}.</p>{/if}
</div>

<div class="fc">
	<label class="fc-l" for="{id}-service">{now ? 'What' : 'What was done'}</label>
	<select
		id="{id}-service"
		class="ti"
		bind:value={serviceId}
		aria-invalid={errors.service_id ? 'true' : undefined}
		aria-describedby={described('service_id', !!serviceId)}
	>
		{#if !serviceId}<option value={null} disabled>Pick what was done</option>{/if}
		{#each choices.services as sv (sv.id)}<option value={sv.id}>{sv.name}</option>{/each}
	</select>
	{#if errors.service_id}
		{@render wrong('service_id')}
	{:else if serviceId}
		<p class="fc-c" id="{id}-service_id-c">
			{rate
				? `${unitPrice(rate)} ${per(service?.unit)}${crew === 'team' ? `, for a crew of ${heads}` : ''}${entityId ? '' : ', to whoever pays'}.`
				: 'Not priced, so it bills nothing until it is.'}
		</p>
	{/if}
</div>

<fieldset
	class="fc"
	data-invalid={errors.worked_by ? '' : undefined}
	aria-describedby={errors.worked_by ? `${id}-worked_by-e` : undefined}
>
	<legend class="fc-l">{now ? 'Who is working' : 'Who worked it'}</legend>
	{#if field}
		<label class="rad">
			<input
				type="radio"
				name="{id}-who"
				value={choices.me}
				checked={who !== 'team'}
				onchange={() => pickWho(choices.me)}
			/>
			<span class="rad-t">Just me</span>
		</label>
	{:else}
		{#each choices.people as p (p.id)}
			<label class="rad">
				<input
					type="radio"
					name="{id}-who"
					value={p.id}
					checked={who === p.id}
					onchange={() => pickWho(p.id)}
				/>
				<span class="rad-t">{p.name}</span>
			</label>
		{/each}
	{/if}
	<label class="rad">
		<input
			type="radio"
			name="{id}-who"
			value="team"
			checked={who === 'team'}
			onchange={() => pickWho('team')}
		/>
		<span class="rad-t">A team</span>
	</label>
	{@render wrong('worked_by')}
</fieldset>

{#if crew === 'team'}
	<fieldset
		class="fc"
		data-invalid={errors.crew_ids ? '' : undefined}
		aria-describedby="{id}-crew_ids-c{errors.crew_ids ? ` ${id}-crew_ids-e` : ''}"
	>
		<legend class="fc-l">
			{field ? `Who ${now ? 'is' : 'was'} on it with you` : `Who ${now ? 'is' : 'was'} on it`}
		</legend>
		<p class="fc-c" id="{id}-crew_ids-c">
			Billed for {heads}, and each of them paid.{field
				? ' Work you were not on is put down by someone with Full.'
				: ''}
		</p>
		{#if field && me}
			<label class="chk">
				<input type="checkbox" checked disabled />
				<span class="chk-t">{me.name}, you</span>
			</label>
		{/if}
		{#each others as p (p.id)}
			<label class="chk">
				<input type="checkbox" checked={crewIds.includes(p.id)} onchange={() => toggle(p.id)} />
				<span class="chk-t">{p.name}</span>
			</label>
		{/each}
		{@render wrong('crew_ids')}
	</fieldset>
{/if}

{@render when?.()}

<label class="chk">
	<input
		id="{id}-billable"
		type="checkbox"
		bind:checked={billable}
		aria-describedby="{id}-billable-c"
	/>
	<span>
		<span class="chk-t">Billable</span>
		<span class="chk-c" id="{id}-billable-c">Unticked, it is kept off every invoice.</span>
	</span>
</label>

<div class="fc">
	<label class="fc-l" for="{id}-note">Note</label>
	<input
		id="{id}-note"
		class="ti"
		autocomplete="off"
		placeholder={now ? 'What is being done' : 'What was done'}
		aria-describedby="{id}-note-c"
		bind:value={note}
	/>
	<p class="fc-c" id="{id}-note-c">As it appears on the invoice.</p>
</div>
