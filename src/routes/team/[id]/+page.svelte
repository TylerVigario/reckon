<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { ACCESS, ACCESS_WORDS, type Access } from '#lib/access.ts';
	import { PAID_AS_WORDS } from '#lib/pay-words.ts';
	import { parsePersonField } from '#lib/people-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { clock, datedAt } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import type { PageProps } from './$types';

	/**
	 * One person, as Primer draws a record: their name heading it with the
	 * actions menu beside it, and under it a box for who they are and a box for
	 * what they reach and are paid as.
	 *
	 * NAME AND EMAIL ARE EDITED IN PLACE, one row at a time: the pencil opens
	 * that row with Save beside the field, as Primer's saving pattern asks.
	 * Enter saves, Escape leaves it, and what is wrong is said under the field.
	 *
	 * ACCESS AND ROLE CHANGE IN A DIALOG that lists each choice and what it
	 * means, as GitHub's "Change role" does: they change what someone can see
	 * and how they are paid, and a mis-tap there is not noticed the way a
	 * misspelt name is. Deactivate is in the menu, and asks first.
	 */
	let { data }: PageProps = $props();

	const p = $derived(data.person);
	const first = $derived(p.name.split(/\s+/)[0]);
	const isMe = $derived(p.id === data.me);
	// Someone active keeps Full: the last one can't lose it, nor be deactivated.
	const lastFull = $derived(p.active && p.access === 'full' && data.onFull === 1);

	type Plain = 'name' | 'email';
	let editing = $state<Plain | null>(null);
	let draft = $state('');
	let error = $state('');
	let saving = $state(false);
	let saved = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	let asking = $state<'access' | 'role' | 'deactivate' | null>(null);
	let pickAccess = $state<Access>('field');
	let pickRole = $state('');
	let working = $state(false);
	let askError = $state('');

	type Said = { title: string; detail: string; tone: 'good' | 'crit' };
	let said = $state<Said | null>(null);

	/** One field, sent: null once it saved, or what is wrong. */
	async function send(name: string, value: string): Promise<string | null> {
		const r = await fetch(`/api/people/${p.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { [name]: value } })
		}).catch(() => null);
		if (!r) return 'Not saved — no connection.';
		if (!r.ok) {
			const problem = await readProblem(r);
			return problem.errors?.[name] ?? problem.detail ?? 'That did not save.';
		}
		await refreshAll();
		return null;
	}

	function flash(key: string) {
		saved = key;
		clearTimeout(timer);
		timer = setTimeout(() => (saved = null), 4000);
	}

	function edit(key: Plain) {
		editing = key;
		draft = p[key];
		error = '';
	}
	async function leave() {
		const key = editing;
		editing = null;
		error = '';
		await tick();
		document.querySelector<HTMLElement>(`[data-edit="${key}"]`)?.focus();
	}
	async function save() {
		if (!editing || saving) return;
		const key = editing;
		const parsed = parsePersonField(key, draft);
		if (!parsed.ok) return void (error = parsed.why);
		if (parsed.value === p[key]) return leave();
		saving = true;
		const why = await send(key, draft);
		saving = false;
		if (why) return void (error = why);
		flash(key);
		await leave();
	}
	function keys(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			void save();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			void leave();
		}
	}
	const focus = (node: HTMLInputElement) => {
		node.focus();
		node.select();
	};

	function ask(what: 'access' | 'role' | 'deactivate') {
		pickAccess = p.access;
		pickRole = p.role_id ?? '';
		askError = '';
		asking = what;
	}
	async function change(name: 'access' | 'role_id', value: string, was: string) {
		if (value === was) return void (asking = null);
		working = true;
		const why = await send(name, value);
		working = false;
		if (why) return void (askError = why);
		asking = null;
		flash(name);
	}
	async function setActive(active: boolean) {
		working = true;
		const why = await send('active', String(active));
		working = false;
		asking = null;
		said = why
			? { title: active ? 'Not reactivated' : 'Not deactivated', detail: why, tone: 'crit' }
			: active
				? {
						title: `${p.name} reactivated`,
						detail: `${first} can sign in again, and is offered work.`,
						tone: 'good'
					}
				: {
						title: `${p.name} deactivated`,
						detail: `${first} is signed out and can’t sign in. Their time, trips and pay are kept.`,
						tone: 'good'
					};
	}

	const menu = $derived(
		p.active
			? [
					{
						label: 'Deactivate',
						danger: true,
						inactive: isMe
							? 'You can’t deactivate yourself'
							: lastFull
								? 'Someone has to keep Full access'
								: undefined,
						onselect: (): void => ask('deactivate')
					}
				]
			: [{ label: 'Reactivate', onselect: (): void => void setActive(true) }]
	);

	const paidAs = (k: keyof typeof PAID_AS_WORDS | null) =>
		k ? `Paid ${PAID_AS_WORDS[k].money}` : 'What it is paid as isn’t said yet';
	const NOT_PAID = 'Signs in, and isn’t paid for work';
	const held = $derived(data.roles.find((r) => r.id === p.role_id) ?? null);
</script>

{#snippet savedMark(key: string)}
	{#if saved === key}
		<span class="saved" role="status"><Octicon name="check" />Saved</span>
	{/if}
{/snippet}

{#snippet plain(key: Plain, label: string, caption: string)}
	<div class="box-row kv">
		{#if editing === key}
			<label class="kv-l" for="edit-{key}">{label}</label>
			<div class="kv-edit">
				<div class="ie">
					<input
						id="edit-{key}"
						class="ti"
						type={key === 'email' ? 'email' : 'text'}
						autocomplete="off"
						bind:value={draft}
						aria-invalid={error ? 'true' : undefined}
						aria-describedby={error || caption ? `about-${key}` : undefined}
						onkeydown={keys}
						use:focus
					/>
					<button type="button" class="btn sm pri" onclick={save} disabled={saving}
						>{saving ? 'Saving…' : 'Save'}</button
					>
					<button type="button" class="btn sm" onclick={leave} disabled={saving}>Cancel</button>
				</div>
				{#if error}
					<p class="fc-e" id="about-{key}"><Octicon name="alert" />{error}</p>
				{:else if caption}
					<p class="fc-c" id="about-{key}">{caption}</p>
				{/if}
			</div>
		{:else}
			<span class="kv-l">{label}</span>
			<span class="kv-v"><span>{p[key]} {@render savedMark(key)}</span></span>
			<span class="end">
				{#if editing === null}
					<button
						type="button"
						class="ib"
						data-edit={key}
						aria-label="Edit {label.toLowerCase()}"
						onclick={() => edit(key)}><Octicon name="pencil" /></button
					>
				{/if}
			</span>
		{/if}
	</div>
{/snippet}

<Top title={p.name} back={resolve('/team')} backLabel="Team">
	{#snippet actions()}
		<ActionMenu label="Actions for {p.name}" items={menu} />
	{/snippet}
</Top>

<div class="pad primer">
	<div class="state">
		<span class="lab" class:good={p.active}>{p.active ? 'Active' : 'Deactivated'}</span>
		<span class="muted">
			{p.last_signed_in_at
				? `Last signed in at ${clock(p.last_signed_in_at, personalZone())} on ${datedAt(p.last_signed_in_at, personalZone())}`
				: 'No sign-in recorded'}
		</span>
	</div>

	{#if said}
		<div class="banner {said.tone}" role="status">
			<Octicon name={said.tone === 'good' ? 'checkCircle' : 'alert'} />
			<div class="banner-m">
				<p class="banner-t">{said.title}</p>
				<p class="banner-d">{said.detail}</p>
			</div>
			<button type="button" class="ib" aria-label="Dismiss" onclick={() => (said = null)}>
				<Octicon name="x" />
			</button>
		</div>
	{/if}

	<section class="box" aria-labelledby="details-h">
		<div class="box-h"><h2 class="box-t" id="details-h">Details</h2></div>
		{@render plain('name', 'Name', '')}
		{@render plain('email', 'Email', 'They sign in with this.')}
	</section>

	<section class="box" aria-labelledby="reach-h">
		<div class="box-h"><h2 class="box-t" id="reach-h">Access and pay</h2></div>
		<div class="box-row kv">
			<span class="kv-l">Access</span>
			<span class="kv-v">
				<span>{ACCESS_WORDS[p.access].label} {@render savedMark('access')}</span>
				<span class="sub">{ACCESS_WORDS[p.access].reach}</span>
			</span>
			<span class="end">
				{#if editing === null}
					<button type="button" class="ib" aria-label="Change access" onclick={() => ask('access')}
						><Octicon name="pencil" /></button
					>
				{/if}
			</span>
		</div>
		<div class="box-row kv">
			<span class="kv-l">Role</span>
			<span class="kv-v">
				<span>{held?.name ?? 'Not paid'} {@render savedMark('role_id')}</span>
				<span class="sub">{held ? paidAs(held.pays_as) : NOT_PAID}</span>
			</span>
			<span class="end">
				{#if editing === null}
					<button type="button" class="ib" aria-label="Change role" onclick={() => ask('role')}
						><Octicon name="pencil" /></button
					>
				{/if}
			</span>
		</div>
		<div class="box-row kv">
			<span class="kv-l">Pay</span>
			<span class="kv-v"
				><span class="sub">What they’re owed, and what they’ve been paid</span></span
			>
			<span class="end"
				><a class="lk" href={resolve('/reports/pay/[person]', { person: p.id })}>View pay</a></span
			>
		</div>
	</section>

	<Dialog
		open={asking === 'access'}
		title="Change {first}’s access"
		go="Change access"
		going="Changing…"
		{working}
		ongo={() =>
			lastFull && pickAccess !== 'full' ? undefined : change('access', pickAccess, p.access)}
		onclose={() => (asking = null)}
	>
		<fieldset class="fc">
			<legend class="fc-l">Access</legend>
			{#each ACCESS as a (a)}
				<label class="rad">
					<input type="radio" name="access" value={a} bind:group={pickAccess} />
					<span>
						<span class="rad-t">{ACCESS_WORDS[a].label}</span>
						<span class="rad-c">{ACCESS_WORDS[a].detail}</span>
					</span>
				</label>
			{/each}
		</fieldset>
		{#if lastFull && pickAccess !== 'full'}
			<p class="fc-e">
				<Octicon name="alert" />{first} is the only one with Full access, and someone has to keep it.
				Give someone else Full first.
			</p>
		{:else if askError}
			<p class="fc-e"><Octicon name="alert" />{askError}</p>
		{/if}
	</Dialog>

	<Dialog
		open={asking === 'role'}
		title="Change {first}’s role"
		go="Change role"
		going="Changing…"
		{working}
		ongo={() => change('role_id', pickRole, p.role_id ?? '')}
		onclose={() => (asking = null)}
	>
		<fieldset class="fc">
			<legend class="fc-l">Role</legend>
			{#each data.roles as r (r.id)}
				<label class="rad">
					<input type="radio" name="role" value={r.id} bind:group={pickRole} />
					<span>
						<span class="rad-t">{r.name}</span>
						<span class="rad-c">{paidAs(r.pays_as)}</span>
					</span>
				</label>
			{/each}
			<label class="rad">
				<input type="radio" name="role" value="" bind:group={pickRole} />
				<span>
					<span class="rad-t">Not paid</span>
					<span class="rad-c">{NOT_PAID}</span>
				</span>
			</label>
		</fieldset>
		{#if askError}
			<p class="fc-e"><Octicon name="alert" />{askError}</p>
		{/if}
		<p class="note">
			What each role pays for each kind of work is set on <a href={resolve('/services')}
				>each service</a
			>.
		</p>
	</Dialog>

	<Dialog
		open={asking === 'deactivate'}
		title="Deactivate {p.name}?"
		go="Deactivate"
		going="Deactivating…"
		tone="danger"
		{working}
		ongo={() => setActive(false)}
		onclose={() => (asking = null)}
	>
		<p>
			{first} is signed out, can’t sign in, and isn’t offered work. Their time, trips and pay are kept,
			and you can reactivate them.
		</p>
	</Dialog>
</div>

<style>
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}
	.kv {
		display: grid;
		grid-template-columns: minmax(0, 30%) minmax(0, 1fr) auto;
		align-items: center;
		gap: 4px 16px;
		min-height: 56px;
		box-sizing: border-box;
	}
	.kv-l {
		font-weight: 600;
	}
	.kv-v {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--ink-2);
		overflow-wrap: anywhere;
	}
	.sub {
		font-size: 12px;
		color: var(--ink-3);
	}
	.end {
		display: flex;
		justify-content: flex-end;
		min-width: 32px;
	}
	.kv-edit {
		grid-column: 2 / -1;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ie {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.ie .ti {
		flex: 1 1 14rem;
		width: auto;
	}
	.saved {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--good);
	}
	/* Label above value on a phone, the pencil beside both. */
	@media (max-width: 543px) {
		.kv {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.kv-l {
			grid-column: 1;
			grid-row: 1;
		}
		.kv-v {
			grid-column: 1;
			grid-row: 2;
		}
		.end {
			grid-column: 2;
			grid-row: 1 / span 2;
		}
		.kv-edit {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}
</style>
