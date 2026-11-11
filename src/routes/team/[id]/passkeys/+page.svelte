<script lang="ts">
	import Dialog from '#lib/Dialog.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { readProblem } from '#lib/json.ts';
	import { clock, datedAt } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * One person's passkeys, the second of their tabs (+layout.svelte), as Your
	 * profile lists them for themselves: each one's name, its passkey manager,
	 * whether it is synced, when it was made, and when and from where it was
	 * last used. Each is ended on its own, for the phone or computer holding it
	 * being lost or stolen, and asks first: they are signed out everywhere, and
	 * the rest keep working (api/people/[id]/passkeys/[passkey]). One's own are
	 * listed, and changed on Your profile.
	 */
	let { data }: PageProps = $props();

	const p = $derived(data.person);
	const first = $derived(p.name.split(/\s+/)[0]);
	const isMe = $derived(p.id === data.me);
	const when = (iso: string) => `${datedAt(iso, personalZone())}, ${clock(iso, personalZone())}`;

	type Said = { title: string; detail: string; tone: 'good' | 'crit' };
	let said = $state<Said | null>(null);
	let ending = $state<{ id: string; label: string } | null>(null);
	let working = $state(false);
	let askError = $state('');

	function ask(k: { id: string; label: string }) {
		askError = '';
		ending = { id: k.id, label: k.label };
	}

	async function end() {
		if (!ending) return;
		const { id, label } = ending;
		working = true;
		const r = await fetch(`/api/people/${p.id}/passkeys/${id}`, { method: 'DELETE' }).catch(
			() => null
		);
		working = false;
		if (!r?.ok) {
			const problem = r ? await readProblem(r) : null;
			askError = problem
				? (problem.errors?.passkey ?? problem.detail ?? 'Nothing was ended.')
				: 'Nothing was ended — no connection.';
			return;
		}
		const { left } = (await r.json()) as { left: number };
		ending = null;
		said = {
			title: `${label} is ended`,
			detail: left
				? `${first} is signed out everywhere, and signs in again with ${left === 1 ? 'their other passkey' : 'one of their other passkeys'}. We emailed ${p.email} to say so.`
				: `It was their last, so ${first} can’t sign in until you send them a new link. We emailed ${p.email} to say so.`,
			tone: 'good'
		};
		await refreshAll();
	}
</script>

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

<section class="box" aria-labelledby="passkeys-h">
	<div class="box-h">
		<h2 class="box-t" id="passkeys-h">
			{data.list.length}
			{data.list.length === 1 ? 'passkey' : 'passkeys'}
		</h2>
	</div>
	{#each data.list as k (k.id)}
		<div class="box-row">
			<span class="who">
				<span class="n">{k.label}</span>
				<span class="e"
					>{k.keeper && k.keeper !== k.label ? `${k.keeper} · ` : ''}{k.synced
						? 'Synced between their devices'
						: 'On one device'}</span
				>
				<span class="e"
					>Added {when(k.created)} · {k.lastUsed
						? `Last used ${when(k.lastUsed)}${k.lastFrom ? `, from ${k.lastFrom}` : ''}`
						: 'Not used to sign in yet'}</span
				>
			</span>
			{#if !isMe}
				<button type="button" class="btn sm danger" onclick={() => ask(k)}>End</button>
			{/if}
		</div>
	{:else}
		<div class="box-row">
			<span class="muted">
				{p.last_signed_in_at
					? `None. ${first} can’t sign in until you send them a new link.`
					: `None yet. ${first} makes their first with their invitation.`}
			</span>
		</div>
	{/each}
</section>

{#if isMe}
	<p class="note">
		Yours are renamed, removed and added on <a href={resolve('/profile/passkeys')}>Your profile</a>.
	</p>
{/if}

<Dialog
	open={!!ending}
	title="End {first}’s passkey?"
	go="End passkey"
	going="Ending…"
	tone="danger"
	{working}
	ongo={end}
	onclose={() => (ending = null)}
>
	<p>
		{ending?.label} stops working now, and {first} is signed out everywhere, so a lost or stolen phone
		or computer can’t sign in as them. We email {p.email} to say so.
	</p>
	<p>
		{data.list.length === 1
			? `It’s their last, so they can’t sign in again until you send them a new link.`
			: 'Their other passkeys still work.'}
	</p>
	{#if askError}
		<p class="fc-e"><Octicon name="alert" />{askError}</p>
	{/if}
</Dialog>

<style>
	.box-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		box-sizing: border-box;
	}
	/* The name and its lines take the row; End stays beside them, at its end. */
	.who {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.n {
		font-weight: 600;
	}
	.e {
		font-size: 12px;
		color: var(--ink-3);
		overflow-wrap: anywhere;
	}
</style>
