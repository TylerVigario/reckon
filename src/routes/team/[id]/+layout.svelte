<script lang="ts">
	import Top from '#lib/Top.svelte';
	import ActionMenu from '#lib/ActionMenu.svelte';
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { STANDING, standing } from '#lib/people-fields.ts';
	import { readProblem } from '#lib/json.ts';
	import { clock, datedAt } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import type { LayoutProps } from './$types';

	/**
	 * One person, as Primer draws a record: their name heading it with the
	 * actions menu beside it, where they stand under it, then their tabs --
	 * Details and Passkeys, each its own address (Primer's UnderlineNav: "Use
	 * the UnderlineNav component when activating a tab changes the URL").
	 *
	 * SIGNING IN is with a passkey, made with a link emailed to them
	 * (#lib/server/links): an invitation, until they make their first, then a
	 * new link, for someone who can't sign in, which adds one. Sending it asks
	 * whether a phone or computer of theirs is lost or stolen, with no answer
	 * chosen: if one is, every passkey they have ends, and they are signed out
	 * everywhere, as it goes; if not, theirs keep working, as for a phone left
	 * at home. End their passkeys does the same with no link, for someone who
	 * reports one lost (api/people/[id]/passkeys); one passkey alone is ended
	 * on the Passkeys tab. The line under their name says when the link
	 * waiting went and until when it works, or that it lapsed, with Resend
	 * invitation beside one that did. Nobody here sees the link (ASVS 5.0
	 * 6.4.6).
	 *
	 * Send a new link, End their passkeys and Deactivate are in the menu, and
	 * ask first. What each did is said under the tabs.
	 */
	let { data, children }: LayoutProps = $props();

	const p = $derived(data.person);
	const first = $derived(p.name.split(/\s+/)[0]);
	const isMe = $derived(p.id === data.me);
	// Someone active keeps Full: the last one can't lose it, nor be deactivated.
	const lastFull = $derived(p.active && p.access === 'full' && data.onFull === 1);
	const at = (t: string | Date) => `${clock(t, personalZone())} on ${datedAt(t, personalZone())}`;

	let asking = $state<'reset' | 'end' | 'deactivate' | null>(null);
	// Whether a phone or computer of theirs is lost or stolen: unanswered until asked.
	let lost = $state<boolean | null>(null);
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

	function ask(what: 'reset' | 'end' | 'deactivate') {
		lost = null;
		askError = '';
		asking = what;
	}

	async function setActive(active: boolean) {
		working = true;
		const r = await fetch(`/api/people/${p.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fields: { active: String(active) } })
		}).catch(() => null);
		const why = !r
			? 'Not saved — no connection.'
			: r.ok
				? null
				: await readProblem(r).then(
						(problem) => problem.errors?.active ?? problem.detail ?? 'That did not save.'
					);
		if (!why) await refreshAll();
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

	const tabs = $derived([
		{
			href: resolve('/team/[id]', { id: p.id }),
			label: 'Details',
			current: page.route.id === '/team/[id]'
		},
		{
			href: resolve('/team/[id]/passkeys', { id: p.id }),
			label: 'Passkeys',
			count: data.passkeys,
			current: page.route.id === '/team/[id]/passkeys'
		}
	]);
</script>

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

	<UnderlineNav label="{p.name}’s record" items={tabs} />

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

	{@render children()}

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
		<p>
			They can’t sign in again until you send them a new link. To end just one, use their Passkeys
			tab.
		</p>
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
</style>
