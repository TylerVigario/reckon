<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import OfflineBanner from '#lib/OfflineBanner.svelte';
	import { readNewService } from '#lib/service-fields.ts';
	import { todayIn } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { enqueueService, findService, flush } from '#lib/queue.ts';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * A new service: what it is called, what it is charged per, and, if it is
	 * known now, what every client pays for it -- the first person, and each
	 * one after. Everything else -- a client's own price, and whom it pays -- is
	 * set on its own screen, which is where this goes next.
	 *
	 * Kept on the phone first and sent by the queue (#lib/queue), so a service
	 * is added with no signal too, and can be timed, entered and driven under
	 * at once (#lib/services-held): what uses it waits for it.
	 */
	let { data }: PageProps = $props();
	let name = $state('');
	let unit = $state('hour');
	let rate = $state('');
	let additional = $state('');
	let errors = $state<Record<string, string>>({});
	let saying = $state('');
	let saving = $state(false);
	/** Kept on the phone, waiting for a signal. */
	let waiting = $state(false);
	/** The uuid it is added with: kept while it is fixed, so it is one service. */
	let uuid: string = crypto.randomUUID();
	// A service the server refused, opened again to be fixed.
	onMount(() => {
		const id = page.url.searchParams.get('fix');
		if (!id) return;
		void findService(id).then(
			(q) => {
				if (!q) return;
				uuid = q.service.client_uuid;
				name = q.service.fields.name;
				unit = q.service.fields.unit;
				rate = q.service.fields.rate;
				additional = q.service.fields.additional_rate;
				errors = q.refused?.errors ?? {};
				if (q.refused && !Object.keys(errors).length) saying = q.refused.detail;
			},
			() => {}
		);
	});
	const UNITS = [
		{ v: 'hour', l: 'Hour', c: 'Timed, and billed to the minute unless you say otherwise.' },
		{ v: 'mile', l: 'Mile', c: 'Charged by the distance a trip assigns it.' },
		{
			v: 'each',
			l: 'Each',
			c: 'A flat rate: the same charge for each entry, however long it took.'
		}
	];
	const per = $derived(unit === 'hour' ? 'an hour' : unit === 'mile' ? 'a mile' : 'each');

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (saving) return;
		const fields = { name, unit, rate, additional_rate: additional };
		errors = readNewService(fields).errors;
		saying = '';
		if (Object.keys(errors).length) return;
		saving = true;
		try {
			await enqueueService({
				client_uuid: uuid,
				fields,
				from: todayIn(personalZone()),
				made_at: new Date().toISOString()
			});
		} catch {
			saving = false;
			return void (saying = 'This phone would not keep it, so it is not added.');
		}
		// A few seconds for the server to take it; no longer, on a weak signal.
		await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
		const left = await findService(uuid).catch(() => undefined);
		saving = false;
		if (!left) return void (await goto(resolve('/catalogue/services/[id]', { id: uuid })));
		if (left.refused) {
			errors = left.refused.errors ?? {};
			if (!Object.keys(errors).length) saying = left.refused.detail;
			return;
		}
		waiting = true;
	}
</script>

<Top
	title="New service"
	sub="Priced for every client now, or on its own screen"
	back={resolve('/catalogue/services')}
	backLabel="Services"
/>

<div class="pad primer">
	<OfflineBanner asOf={data.as_of} />
	{#if waiting}
		<div class="banner" role="status">
			<Octicon name="info" />
			<div class="banner-m">
				<p class="banner-t">{name} is on this phone, waiting to send</p>
				<p class="banner-d">
					It can be timed, entered and driven under now; what uses it waits for it.
					<a href={resolve('/timesheet/start')}>Start a timer</a> ·
					<a href={resolve('/timesheet/manual')}>Add past work</a>
				</p>
			</div>
		</div>
	{:else}
		<form class="box" onsubmit={create} novalidate>
			<div class="box-row form">
				<div class="fc">
					<label class="fc-l" for="n-name">Name<span aria-hidden="true"> *</span></label>
					<input
						id="n-name"
						class="ti"
						autocomplete="off"
						bind:value={name}
						aria-invalid={errors.name ? 'true' : undefined}
						aria-describedby={errors.name ? 'n-name-e' : undefined}
					/>
					{#if errors.name}<p class="fc-e" id="n-name-e">
							<Octicon name="alert" />{errors.name}
						</p>{/if}
				</div>
				<fieldset class="fc">
					<legend class="fc-l">Charged per</legend>
					{#each UNITS as u (u.v)}
						<label class="rad">
							<input type="radio" name="unit" value={u.v} bind:group={unit} />
							<span><span class="rad-t">{u.l}</span><span class="rad-c">{u.c}</span></span>
						</label>
					{/each}
					{#if errors.unit}<p class="fc-e"><Octicon name="alert" />{errors.unit}</p>{/if}
				</fieldset>
				<div class="pair">
					<div class="fc">
						<label class="fc-l" for="n-rate">Every client pays</label>
						<span class="tv">
							<input
								id="n-rate"
								class="ti"
								inputmode="decimal"
								autocomplete="off"
								bind:value={rate}
								aria-invalid={errors.rate ? 'true' : undefined}
								aria-describedby={errors.rate ? 'n-rate-e' : 'n-rate-c'}
							/>
							<span class="tv-v" aria-hidden="true">{per}</span>
						</span>
						{#if errors.rate}
							<p class="fc-e" id="n-rate-e"><Octicon name="alert" />{errors.rate}</p>
						{:else}
							<p class="fc-c" id="n-rate-c">Empty: priced later, on its own screen.</p>
						{/if}
					</div>
					<div class="fc">
						<label class="fc-l" for="n-more">Each person after</label>
						<input
							id="n-more"
							class="ti"
							inputmode="decimal"
							autocomplete="off"
							bind:value={additional}
							aria-invalid={errors.additional_rate ? 'true' : undefined}
							aria-describedby={errors.additional_rate ? 'n-more-e' : undefined}
						/>
						{#if errors.additional_rate}
							<p class="fc-e" id="n-more-e"><Octicon name="alert" />{errors.additional_rate}</p>
						{/if}
					</div>
				</div>
			</div>
			<div class="box-row keep">
				<button type="submit" class="btn pri" disabled={saving}
					>{saving ? 'Adding…' : 'Add the service'}</button
				>
				<a class="btn" href={resolve('/catalogue/services')}>Cancel</a>
				{#if saying}<p class="fc-e"><Octicon name="alert" />{saying}</p>{/if}
			</div>
		</form>
	{/if}
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
	}
	.fc {
		max-width: 440px;
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 20px;
		max-width: 440px;
	}
	.tv {
		position: relative;
		display: block;
	}
	.tv .ti {
		padding-right: 72px;
	}
	.tv-v {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 13px;
		color: var(--ink-3);
		pointer-events: none;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--surface-2);
	}
</style>
