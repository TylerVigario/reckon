<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { ACCESS, ACCESS_WORDS, type Access } from '#lib/access.ts';
	import { PAID_AS_WORDS } from '#lib/pay-words.ts';
	import { STANDING, parsePersonField, standing } from '#lib/people-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { clock, datedAt } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
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
	 * misspelt name is. Send a new link, End their passkeys and Deactivate are
	 * in the menu, and ask first.
	 *
	 * SIGNING IN is with a passkey, made with a link emailed to them
	 * (#lib/server/links): an invitation, until they make their first, then a
	 * new link, for someone who can't sign in, which adds one. Sending it asks
	 * whether a phone or computer of theirs is lost or stolen, with no answer
	 * chosen: if one is, every passkey they have ends, and they are signed out
	 * everywhere, as it goes; if not, theirs keep working, as for a phone left
	 * at home. End their passkeys does the same with no link, for someone who
	 * reports one lost (api/people/[id]/passkeys). The line under their name
	 * says when the link waiting went and until when it works, or that it
	 * lapsed, with Resend invitation beside one that did. Nobody here sees the
	 * link (ASVS 5.0 6.4.6).
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

	type Asking = 'access' | 'role' | 'reset' | 'end' | 'deactivate';
	let asking = $state<Asking | null>(null);
	// Whether a phone or computer of theirs is lost or stolen: unanswered until asked.
	let lost = $state<boolean | null>(null);
	const at = (t: string | Date) => `${clock(t, personalZone())} on ${datedAt(t, personalZone())}`;
	let pickAccess = $state<Access>('field');
	let pickRole = $state('');
	let working = $state(false);
	let askError = $state('');

	type Said = { title: string; detail: string; tone: 'good' | 'crit' };
	const invitedSaid = (to: string, until: string): Said => ({
		title: `Invitation sent to ${to}`,
		detail: `${data.person.name.split(/\s+/)[0]} makes their passkey with the link in it. It works once, until ${at(until)}. If it doesn’t reach them, send it again from the menu.`,
		tone: 'good'
	});
	// Someone just added arrives with word that their invitation went (team/new).
	let said = $state<Said | null>(
		untrack(() => {
			const sent = page.state.invited;
			return sent ? invitedSaid(sent.to, sent.until) : null;
		})
	);

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

	function ask(what: Asking) {
		pickAccess = p.access;
		pickRole = p.role_id ?? '';
		lost = null;
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

	/** Sends a link, a new one to make a passkey with or an invitation: what went, or why not. */
	async function sendLink(what: 'link' | 'invitation') {
		// With no passkey, there is none to end.
		const asked = what === 'link' && p.has_passkey;
		if (asked && lost === null)
			return void (askError = 'Say whether a phone or computer of theirs is lost or stolen.');
		working = true;
		const r = await fetch(`/api/people/${p.id}/${what}`, {
			method: 'POST',
			...(what === 'link'
				? {
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ lost: asked && lost === true })
					}
				: {})
		}).catch(() => null);
		working = false;
		if (!r?.ok) {
			const problem = r ? await readProblem(r) : null;
			const why = problem
				? (problem.errors?.[what] ?? problem.detail ?? 'Nothing was sent.')
				: 'Nothing was sent — no connection.';
			if (asking) return void (askError = why);
			said = {
				title: what === 'link' ? 'New link not sent' : 'Invitation not sent',
				detail: why,
				tone: 'crit'
			};
			return;
		}
		const { sent_to, until, ended } = (await r.json()) as {
			sent_to: string;
			until: string;
			ended?: boolean;
		};
		asking = null;
		said =
			what === 'invitation'
				? invitedSaid(sent_to, until)
				: {
						title: `New link sent to ${sent_to}`,
						detail: `It lets ${first} make a new passkey, once, until ${at(until)}. ${
							ended
								? 'The passkeys they had are ended, and they’re signed out everywhere.'
								: p.has_passkey
									? 'The passkeys they have still work.'
									: ''
						}`.trim(),
						tone: 'good'
					};
		await refreshAll();
	}
	const reset = () => sendLink('link');
	const resend = () => sendLink('invitation');

	/** Every passkey they have ended, and they signed out everywhere: what happened, or why not. */
	async function endTheirs() {
		working = true;
		const r = await fetch(`/api/people/${p.id}/passkeys`, { method: 'DELETE' }).catch(() => null);
		working = false;
		if (!r?.ok) {
			const problem = r ? await readProblem(r) : null;
			askError = problem
				? (problem.errors?.passkeys ?? problem.detail ?? 'Nothing was ended.')
				: 'Nothing was ended — no connection.';
			return;
		}
		asking = null;
		said = {
			title: `${first}’s passkeys are ended`,
			detail: `They’re signed out everywhere, and we emailed ${p.email} to say so. To let them sign in again, send them a new link.`,
			tone: 'good'
		};
		await refreshAll();
	}

	const where = $derived(standing(p));
	const unsent = $derived(
		data.cannotSend === 'SMTP_HOST'
			? 'Email isn’t set up: SMTP_HOST is unset'
			: data.cannotSend === 'SITE_URL'
				? 'Email isn’t set up: SITE_URL is unset'
				: undefined
	);

	const menu = $derived(
		p.active
			? [
					where === 'invited' || where === 'expired' || where === 'uninvited'
						? {
								label: where === 'uninvited' ? 'Send invitation' : 'Resend invitation',
								inactive: unsent,
								onselect: (): void => void resend()
							}
						: {
								label: 'Send a new link',
								inactive: isMe ? 'Your own passkeys are on Your profile' : unsent,
								onselect: (): void => ask('reset')
							},
					'divider' as const,
					...(where === 'active'
						? [
								{
									label: 'End their passkeys',
									danger: true,
									inactive: isMe
										? 'Your own passkeys are on Your profile'
										: !p.has_passkey
											? 'They have no passkey'
											: undefined,
									onselect: (): void => ask('end')
								}
							]
						: []),
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

<Top title={p.name} back={resolve('/team')} backLabel="Team">
	{#snippet actions()}
		<ActionMenu label="Actions for {p.name}" items={menu} />
	{/snippet}
</Top>

<div class="pad primer">
	<div class="state">
		<span class="lab {STANDING[where].tone}">{STANDING[where].label}</span>
		{#if where === 'invited' && p.waiting}
			<span class="muted"
				>Invitation sent at {at(p.waiting.sent_at)} · works until {at(p.waiting.until)}</span
			>
		{:else if where === 'uninvited'}
			<span class="muted">Has no passkey, and has never been sent an invitation</span>
			<button type="button" class="btn sm" onclick={resend} disabled={working || !!unsent}
				>Send invitation</button
			>
		{:else if where === 'expired'}
			<span class="muted">
				{p.waiting
					? `Sent at ${at(p.waiting.sent_at)}, and not used within the hour`
					: 'No invitation waiting'}
			</span>
			<button type="button" class="btn sm" onclick={resend} disabled={working || !!unsent}
				>Resend invitation</button
			>
		{:else}
			<span class="muted">
				{p.last_signed_in_at
					? `Last signed in at ${at(p.last_signed_in_at)}`
					: 'No sign-in recorded'}
			</span>
			{#if p.active && p.waiting?.purpose === 'reset' && !p.waiting.lapsed}
				<span class="muted"
					>New link sent at {at(p.waiting.sent_at)} · works until {at(p.waiting.until)}</span
				>
			{:else if p.active && !p.has_passkey}
				{@const lapsed = p.waiting?.purpose === 'reset'}
				<span class="muted"
					>{lapsed
						? 'Has no passkey: their new link lapsed unused'
						: 'Has no passkey, so can’t sign in'}</span
				>
				<button
					type="button"
					class="btn sm"
					onclick={() => ask('reset')}
					disabled={working || !!unsent || isMe}
					>{lapsed ? 'Send another' : 'Send a new link'}</button
				>
			{/if}
		{/if}
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
		open={asking === 'reset'}
		title="Send {first} a new link?"
		go={lost ? 'End passkeys and send' : 'Send a new link'}
		going="Sending…"
		tone={lost ? 'danger' : 'plain'}
		{working}
		ongo={reset}
		onclose={() => (asking = null)}
	>
		<p>
			We email {p.email} a link to make a new passkey, which works once, for an hour.
		</p>
		{#if p.has_passkey}
			<fieldset class="fc">
				<legend class="fc-l"
					>Is a phone or computer with one of their passkeys lost or stolen?</legend
				>
				<label class="rad">
					<input
						type="radio"
						name="lost"
						value="yes"
						checked={lost === true}
						onchange={() => ((lost = true), (askError = ''))}
					/>
					<span>
						<span class="rad-t">Yes, end their passkeys</span>
						<span class="rad-c"
							>Every passkey {first} has stops working, and they’re signed out everywhere, as the link
							goes.</span
						>
					</span>
				</label>
				<label class="rad">
					<input
						type="radio"
						name="lost"
						value="no"
						checked={lost === false}
						onchange={() => ((lost = false), (askError = ''))}
					/>
					<span>
						<span class="rad-t">No, keep their passkeys</span>
						<span class="rad-c"
							>They just can’t reach theirs: one left at home still signs them in once they’re back
							to it.</span
						>
					</span>
				</label>
			</fieldset>
		{/if}
		{#if askError}
			<p class="fc-e"><Octicon name="alert" />{askError}</p>
		{/if}
	</Dialog>

	<Dialog
		open={asking === 'end'}
		title="End {first}’s passkeys?"
		go="End passkeys"
		going="Ending…"
		tone="danger"
		{working}
		ongo={endTheirs}
		onclose={() => (asking = null)}
	>
		<p>
			Every passkey {first} has stops working now, and they’re signed out everywhere, so a lost or stolen
			phone or computer can’t sign in as them. We email {p.email} to say so.
		</p>
		<p>They can’t sign in again until you send them a new link.</p>
		{#if askError}
			<p class="fc-e"><Octicon name="alert" />{askError}</p>
		{/if}
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
			{first} is signed out, can’t sign in, and isn’t offered work.
			{#if where === 'invited'}Their invitation stops working.{/if}
			Their time, trips and pay are kept, and you can reactivate them.
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
