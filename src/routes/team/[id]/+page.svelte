<script lang="ts">
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { ACCESS, ACCESS_WORDS, type Access } from '#lib/access.ts';
	import { PAID_AS_WORDS } from '#lib/pay-words.ts';
	import { parsePersonField, standing } from '#lib/people-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { clock, datedAt } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import type { PageProps } from './$types';

	/**
	 * One person's details, the first of their tabs (+layout.svelte): a box
	 * for who they are and a box for what they reach and are paid as.
	 *
	 * NAME AND EMAIL ARE EDITED IN PLACE, one row at a time: the pencil opens
	 * that row with Save beside the field, as Primer's saving pattern asks.
	 * Enter saves, Escape leaves it, and what is wrong is said under the field.
	 *
	 * ACCESS AND ROLE CHANGE IN A DIALOG that lists each choice and what it
	 * means, as GitHub's "Change role" does: they change what someone can see
	 * and how they are paid, and a mis-tap there is not noticed the way a
	 * misspelt name is.
	 *
	 * A NEW ADDRESS for someone who has signed in waits: they keep the one they
	 * have until they use the link sent to the new one, and the old one is told
	 * (api/people/[id] changeEmail). The email row shows it Pending, or Expired
	 * once the link lapses, with Send again and Cancel change beside it.
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

	let asking = $state<'access' | 'role' | null>(null);
	const at = (t: string | Date) => `${clock(t, personalZone())} on ${datedAt(t, personalZone())}`;
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
		const why = key === 'email' ? await saveEmail(draft) : await send(key, draft);
		saving = false;
		if (why) return void (error = why);
		if (key !== 'email') flash(key);
		await leave();
	}

	const changeSaid = (to: string, until: string, was: string): Said => ({
		title: `Confirmation link sent to ${to}`,
		detail: `${isMe ? 'You keep' : `${first} keeps`} signing in with ${was} until ${isMe ? 'you' : 'they'} use it, once, by ${at(until)}. We told ${was} that you asked.`,
		tone: 'good'
	});

	/**
	 * A new address: theirs at once, said Saved; or, for someone who has signed
	 * in, waiting for them to use the link sent there, said in a banner.
	 */
	async function saveEmail(value: string): Promise<string | null> {
		const was = p.email;
		const r = await fetch(`/api/people/${p.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { email: value } })
		}).catch(() => null);
		if (!r) return 'Not saved — no connection.';
		if (!r.ok) {
			const problem = await readProblem(r);
			return problem.errors?.email ?? problem.detail ?? 'That did not save.';
		}
		const body = (await r.json()) as { waiting?: { to: string; until: string } };
		if (body.waiting) said = changeSaid(body.waiting.to, body.waiting.until, was);
		else flash('email');
		await refreshAll();
		return null;
	}

	/** The change of address waiting: its link sent again, or the change cancelled. */
	async function changeAgain(how: 'POST' | 'DELETE') {
		const to = p.changing?.to ?? '';
		working = true;
		const r = await fetch(`/api/people/${p.id}/email-change`, { method: how }).catch(() => null);
		working = false;
		if (!r?.ok) {
			const problem = r ? await readProblem(r) : null;
			said = {
				title: how === 'POST' ? 'Not sent' : 'Not cancelled',
				detail: problem
					? (problem.errors?.change ?? problem.detail ?? 'Nothing changed.')
					: 'Nothing changed — no connection.',
				tone: 'crit'
			};
			return;
		}
		if (how === 'POST') {
			const { until } = (await r.json()) as { until: string };
			said = {
				title: `Confirmation link sent again to ${to}`,
				detail: `It works once, until ${at(until)}. The one sent before no longer works.`,
				tone: 'good'
			};
		} else
			said = {
				title: 'Email change cancelled',
				detail: `${isMe ? 'You still sign' : `${first} still signs`} in with ${p.email}. The link sent to ${to} no longer works.`,
				tone: 'good'
			};
		await refreshAll();
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

	function ask(what: 'access' | 'role') {
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

	const where = $derived(standing(p));
	const unsent = $derived(
		data.cannotSend === 'SMTP_HOST'
			? 'Email isn’t set up: SMTP_HOST is unset'
			: data.cannotSend === 'SITE_URL'
				? 'Email isn’t set up: SITE_URL is unset'
				: undefined
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

{#snippet confirmed()}
	{#if p.email_verified}
		<span class="sub ok"><Octicon name="check" />Confirmed</span>
	{:else if where === 'invited' || where === 'expired' || where === 'uninvited'}
		<span class="sub">Not confirmed yet. Using their invitation confirms it.</span>
	{:else}
		<span class="sub">Not confirmed. {first} confirms it from their profile.</span>
	{/if}
{/snippet}

{#snippet changeWaiting()}
	{#if p.changing}
		{@const c = p.changing}
		<span class="change">
			<span class="lab {c.lapsed ? 'crit' : 'warn'}">{c.lapsed ? 'Expired' : 'Pending'}</span>
			<span>{c.to}</span>
		</span>
		<span class="sub">
			{c.lapsed
				? `Link sent at ${at(c.sent_at)}, and not used within the hour. ${isMe ? 'You still sign' : `${first} still signs`} in with ${p.email}.`
				: `Link sent at ${at(c.sent_at)} · works until ${at(c.until)}. ${isMe ? 'You sign' : `${first} signs`} in with ${p.email} until ${isMe ? 'you' : 'they'} use it.`}
		</span>
		<span class="acts">
			<button
				type="button"
				class="btn sm"
				onclick={() => changeAgain('POST')}
				disabled={working || !!unsent || !p.active}>Send again</button
			>
			<button type="button" class="btn sm" onclick={() => changeAgain('DELETE')} disabled={working}
				>Cancel change</button
			>
		</span>
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
			<span class="kv-v"
				><span>{p[key]} {@render savedMark(key)}</span>
				{#if key === 'email'}{@render confirmed()}{@render changeWaiting()}{/if}</span
			>
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
	{@render plain(
		'email',
		'Email',
		where === 'active'
			? 'They sign in with this. A new one takes over once they use the link we email there, and we tell this one.'
			: where === 'deactivated'
				? 'They sign in with this if they’re reactivated. A new one isn’t confirmed until they use a link sent there.'
				: 'They sign in with this. Their invitation goes again, to the new one, and the one sent before stops working.'
	)}
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
		<span class="kv-v"><span class="sub">What they’re owed, and what they’ve been paid</span></span>
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
			<Octicon name="alert" />{first} is the only one with Full access, and someone has to keep it. Give
			someone else Full first.
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

<style>
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
	.sub.ok {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--good);
		font-weight: 600;
	}
	.change {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 6px;
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
