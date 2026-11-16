<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { parseAll } from '#lib/field-rules.ts';
	import { placesWord, PLACES, UNIT_FIELDS } from '#lib/unit-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import type { PageProps } from './$types';

	/**
	 * What stock and lines are counted in: each unit, what is written beside a
	 * figure in it, how finely it is counted, and how many materials are counted
	 * in it. One is added, or changed, in a dialog holding the three; one no
	 * material is counted in is deleted from its menu, asking first, as every
	 * delete does: it cannot be undone.
	 */
	let { data }: PageProps = $props();
	type Unit = (typeof data.units)[number];

	const places = PLACES.map((n) => ({ value: String(n), label: placesWord(n) }));
	const counted = (n: number) =>
		n === 0 ? 'nothing counted in it' : `${n} material${n === 1 ? '' : 's'}`;
	const about = (u: Unit) =>
		[
			u.short && u.short !== u.name ? `written ${u.short}` : null,
			placesWord(u.places).toLowerCase(),
			counted(u.materials)
		]
			.filter(Boolean)
			.join(' · ');

	// The dialog: a new unit, or one being changed.
	let open = $state(false);
	let changing = $state<Unit | null>(null);
	let name = $state('');
	let short = $state('');
	let unitPlaces = $state('0');
	let errors = $state<Record<string, string>>({});
	let problem = $state('');
	let saving = $state(false);

	function add() {
		changing = null;
		name = short = '';
		unitPlaces = '0';
		errors = {};
		problem = '';
		open = true;
	}
	function change(u: Unit) {
		changing = u;
		name = u.name;
		short = u.short ?? '';
		unitPlaces = String(u.places);
		errors = {};
		problem = '';
		open = true;
	}
	async function save() {
		const fields = { name, short, places: unitPlaces };
		errors = parseAll(UNIT_FIELDS, fields).errors;
		problem = '';
		if (Object.keys(errors).length) return;
		saving = true;
		const r = await fetch(changing ? `/api/units/${changing.id}` : '/api/units', {
			method: changing ? 'PATCH' : 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		saving = false;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			errors = p?.errors ?? {};
			if (!Object.keys(errors).length)
				problem = p ? (p.detail ?? 'That did not save.') : 'Not saved — no connection.';
			return;
		}
		open = false;
		await refreshAll();
	}

	let deleting = $state<Unit | null>(null);
	let working = $state(false);
	let failed = $state('');
	async function remove() {
		if (!deleting) return;
		failed = '';
		working = true;
		const r = await fetch(`/api/units/${deleting.id}`, { method: 'DELETE' }).catch(() => null);
		working = false;
		deleting = null;
		if (!r?.ok) {
			failed = r
				? ((await readProblem(r)).detail ?? 'Not deleted.')
				: 'Not deleted — no connection.';
			return;
		}
		await refreshAll();
	}
</script>

{#snippet wrong(key: string)}
	{#if errors[key]}
		<p class="fc-e" id="u-{key}-e"><Octicon name="alert" />{errors[key]}</p>
	{/if}
{/snippet}

<Top
	title="Units"
	sub="What stock and lines are counted in"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	{#if failed}
		<div class="banner crit" role="alert">
			<Octicon name="alert" />
			<div class="banner-m"><p class="banner-t">{failed}</p></div>
		</div>
	{/if}

	<section class="box" aria-labelledby="units-h">
		<div class="box-h">
			<h2 class="box-t" id="units-h">Units</h2>
			<button type="button" class="btn sm" onclick={add}>Add unit</button>
		</div>
		{#each data.units as u (u.id)}
			<div class="box-row" id="unit-{u.id}">
				<span class="what">
					<span class="n">{u.name}</span>
					<span class="sub">{about(u)}</span>
				</span>
				<ActionMenu
					label="Actions for {u.name}"
					items={[
						{ label: 'Change', onselect: () => change(u) },
						...(u.materials
							? []
							: [
									'divider' as const,
									{ label: 'Delete', danger: true, onselect: () => void (deleting = u) }
								])
					]}
				/>
			</div>
		{:else}
			<p class="box-row muted">None yet. Add unit adds the first.</p>
		{/each}
	</section>

	<p class="note">
		A unit is named once and used everywhere: stock, a line and a price are counted in it. A box of
		25 is a unit of its own, and nothing converts one unit into another. A line on an invoice keeps
		the name it was billed in.
	</p>
	<p class="note">
		Hour, mile and each are what a service is charged by. They are not on this list: they decide how
		time and trips are counted.
	</p>
</div>

<Dialog
	{open}
	title={changing ? `Change ${changing.name}` : 'Add unit'}
	go={changing ? 'Save unit' : 'Add unit'}
	going="Saving…"
	working={saving}
	ongo={save}
	onclose={() => (open = false)}
>
	<div class="form">
		<div class="fc">
			<label class="fc-l" for="u-name">Name<span aria-hidden="true"> *</span></label>
			<input
				id="u-name"
				class="ti"
				autocomplete="off"
				required
				placeholder="box of 25"
				bind:value={name}
				aria-invalid={errors.name ? 'true' : undefined}
				aria-describedby={errors.name ? 'u-name-e' : undefined}
			/>
			{@render wrong('name')}
		</div>
		<div class="fc">
			<label class="fc-l" for="u-short">Written beside a figure</label>
			<input
				id="u-short"
				class="ti"
				autocomplete="off"
				placeholder={name || 'The name'}
				bind:value={short}
				aria-invalid={errors.short ? 'true' : undefined}
				aria-describedby={errors.short ? 'u-short-e' : 'u-short-c'}
			/>
			{#if errors.short}
				{@render wrong('short')}
			{:else}
				<p class="fc-c" id="u-short-c">Empty writes the name.</p>
			{/if}
		</div>
		<div class="fc">
			<label class="fc-l" for="u-places">A quantity is counted</label>
			<select id="u-places" class="ti" bind:value={unitPlaces}>
				{#each places as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
			</select>
			{@render wrong('places')}
		</div>
		{#if problem}<p class="fc-e"><Octicon name="alert" />{problem}</p>{/if}
	</div>
</Dialog>

<Dialog
	open={deleting !== null}
	title="Delete {deleting?.name ?? 'the unit'}?"
	go="Delete it"
	going="Deleting…"
	tone="danger"
	{working}
	ongo={remove}
	onclose={() => (deleting = null)}
>
	<p>No material is counted in it. This cannot be undone.</p>
</Dialog>

<style>
	.box-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		box-sizing: border-box;
		margin: 0;
	}
	.what {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.n {
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fgColor-muted);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
</style>
