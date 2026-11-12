<script lang="ts">
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { teamTabs } from '#lib/section-tabs.ts';
	import { ACCESS_WORDS } from '#lib/access.ts';
	import { STANDING, standing } from '#lib/people-fields.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	/**
	 * Team: the people who sign in, and the roles they are paid as, as two
	 * views of one section. People is one box with a row each -- who they are,
	 * their role and access, whether they sign in yet or still -- and each row
	 * opens that person's page, where everything about them is changed. Add
	 * person is the screen's one action, beside its title.
	 */
	let { data }: PageProps = $props();

	const initials = (name: string) =>
		name
			.split(/\s+/)
			.map((w) => w[0] ?? '')
			.join('')
			.slice(0, 2)
			.toUpperCase();
</script>

<Top title="Team" back={resolve('/more')} backLabel="More">
	{#snippet actions()}
		<a class="btn pri sm" href={resolve('/team/new')}>Add person</a>
	{/snippet}
</Top>

<div class="pad primer">
	<UnderlineNav
		label="Team"
		items={teamTabs('people', { people: data.people.length, roles: data.roles })}
	/>

	<section class="box" aria-labelledby="people-h">
		<div class="box-h">
			<h2 class="box-t" id="people-h">
				{data.people.length}
				{data.people.length === 1 ? 'person' : 'people'}
			</h2>
		</div>
		{#each data.people as p (p.id)}
			<a class="box-row" href={resolve('/team/[id]', { id: p.id })}>
				<span class="ava" aria-hidden="true">{initials(p.name)}</span>
				<span class="who">
					<span class="n">{p.name}</span>
					<span class="e">{p.email}</span>
				</span>
				<span class="as">{p.role ?? 'Not paid'} · {ACCESS_WORDS[p.access].label}</span>
				<span class="lab {STANDING[standing(p)].tone}">{STANDING[standing(p)].label}</span>
			</a>
		{/each}
	</section>
</div>

<style>
	.box-row {
		min-height: 64px;
		box-sizing: border-box;
	}
	.who {
		flex: 1 1 auto;
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
	.as {
		flex: 0 0 auto;
		color: var(--ink-2);
	}
	.lab {
		flex: 0 0 auto;
		min-width: 96px;
		justify-content: center;
	}
	/* On a phone the row is who and whether: their role and access are a tap away. */
	@media (max-width: 543px) {
		.as {
			display: none;
		}
		.lab {
			min-width: 0;
		}
	}
</style>
