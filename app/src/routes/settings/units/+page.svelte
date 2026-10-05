<script lang="ts">
	import Top from '#lib/Top.svelte';
	import Setting from '#lib/Setting.svelte';
	import { parseAll } from '#lib/field-rules.ts';
	import { parseUnitField, placesWord, PLACES, UNIT_FIELDS } from '#lib/unit-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const places = PLACES.map((n) => ({ value: String(n), label: placesWord(n) }));
	const counted = (n: number) =>
		n === 0 ? 'Nothing is counted in it' : `${n} material${n === 1 ? '' : 's'}`;

	let name = $state('');
	let short = $state('');
	let newPlaces = $state('0');
	let adding = $state(false);
	let problem = $state('');

	async function add() {
		const fields = { name, short, places: newPlaces };
		const local = parseAll(UNIT_FIELDS, fields).errors;
		problem = local.name ?? local.short ?? local.places ?? '';
		if (problem) return;
		adding = true;
		const r = await fetch('/api/units', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields })
		}).catch(() => null);
		adding = false;
		if (!r?.ok) {
			const p = r ? await readProblem(r) : null;
			problem = p
				? (p.errors?.name ?? p.errors?.short ?? p.errors?.places ?? 'That did not save.')
				: 'Not saved — no connection.';
			return;
		}
		name = '';
		short = '';
		newPlaces = '0';
		await refreshAll();
	}

	async function remove(id: string) {
		problem = '';
		const r = await fetch(`/api/units/${id}`, { method: 'DELETE' }).catch(() => null);
		if (!r?.ok) {
			problem = r
				? ((await readProblem(r)).detail ?? 'Not deleted.')
				: 'Not deleted — no connection.';
			return;
		}
		await refreshAll();
	}
</script>

<Top
	title="Units"
	sub="What stock and lines are counted in"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>Units</h2></div>
		<div class="rows inset">
			{#each data.units as u (u.id)}
				<div class="unit">
					<Setting
						name="name"
						key={u.id}
						label={`Name · ${counted(u.materials)}`}
						value={u.name}
						endpoint="/api/units/{u.id}"
						validate={parseUnitField}
						onsaved={() => refreshAll()}
					/>
					<Setting
						name="short"
						key={u.id}
						label="Written beside a figure"
						value={u.short ?? ''}
						placeholder={u.name}
						endpoint="/api/units/{u.id}"
						validate={parseUnitField}
						onsaved={() => refreshAll()}
					/>
					<Setting
						name="places"
						key={u.id}
						label="A quantity is counted"
						value={String(u.places)}
						options={places}
						endpoint="/api/units/{u.id}"
						validate={parseUnitField}
						onsaved={() => refreshAll()}
					/>
					{#if !u.materials}
						<button type="button" class="btn sm gho" onclick={() => remove(u.id)}
							>Delete {u.name}</button
						>
					{/if}
				</div>
			{/each}

			<div class="fld">
				<label for="new-unit">A new unit</label>
				<input
					id="new-unit"
					class="inp"
					placeholder="box of 25"
					bind:value={name}
					onkeydown={(e) => e.key === 'Enter' && add()}
				/>
			</div>
			<div class="fld">
				<label for="new-short">Written beside a figure</label>
				<input id="new-short" class="inp" placeholder="The name" bind:value={short} />
			</div>
			<div class="fld">
				<label for="new-places">A quantity is counted</label>
				<select id="new-places" class="inp" bind:value={newPlaces}>
					{#each places as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
				</select>
			</div>
			<div class="fld">
				<button type="button" class="btn pri" onclick={add} disabled={adding || !name.trim()}
					>Add the unit</button
				>
				{#if problem}<small class="why">{problem}</small>{/if}
			</div>
		</div>
	</div>

	<div class="rows notes">
		<div class="rec">
			<div class="rec-m">
				<div class="rec-t"><span class="lt">hour · mile · each</span></div>
				<div class="rec-s">
					What a service is charged by. They are not on this list: they decide how time and trips
					are counted.
				</div>
			</div>
		</div>
		<div class="rec">
			<div class="rec-m">
				<div class="rec-t"><span class="lt">A unit is named once and used everywhere</span></div>
				<div class="rec-s">
					Stock, a line and a price are counted in it. A box of 25 is a unit of its own: nothing
					converts one unit into another. A line on an invoice keeps the name it was billed in.
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.unit {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--line);
	}
	.unit .btn {
		align-self: flex-start;
		color: var(--crit);
	}
	.notes {
		margin-top: 22px;
	}
	.why {
		color: var(--crit);
		font-size: 12.5px;
	}
</style>
