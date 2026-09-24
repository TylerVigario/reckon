<script lang="ts">
	import Top from '$lib/Top.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
</script>

<Top
	title="People and pay"
	sub="Who is paid, and under which rules"
	back={resolve('/settings')}
	backLabel="Settings"
/>

<div class="pad">
	<div class="sec">
		<div class="sec-h"><h2>People</h2></div>
		<div class="rows">
			{#each data.people as p (p.id)}
				<div class="rec" class:gone={!p.active}>
					<div class="rec-m">
						<div class="rec-t">{p.name}</div>
						<div class="rec-s">
							{p.email} · {p.role ? 'paid for work' : 'signs in, is not paid for work'}{p.own_rules
								? ` · ${count(p.own_rules, 'rule')} of their own`
								: ''}
						</div>
					</div>
					<div class="rec-n">
						{#if p.role}<span class="chip acc">{p.role}</span>{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="sec">
		<div class="sec-h"><h2>Roles</h2></div>
		<div class="rows">
			{#each data.roles as r (r.id)}
				<div class="rec">
					<div class="rec-m">
						<div class="rec-t">{r.name}</div>
						<div class="rec-s">
							{r.rules ? `Named by ${count(r.rules, 'pay rule')}` : 'No pay rule names it yet'}
						</div>
					</div>
					<div class="rec-n">
						<span class="rec-x" class:mut={!r.holders}>
							{r.holders ? count(r.holders, 'person', 'people') : 'nobody yet'}
						</span>
					</div>
				</div>
			{/each}
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">
						<span class="lt">Roles are the business's own list</span>
					</div>
					<div class="rec-s">
						A service's pay rules are written against them, or against one person. The narrowest
						rule that has started pays: one client's before every client's, one person's before
						their role's.
					</div>
				</div>
			</div>
			<div class="rec">
				<div class="rec-m">
					<div class="rec-t">
						<span class="lt">A role is who someone is now</span>
					</div>
					<div class="rec-s">
						Pay is not yet recorded when it is paid, so until it is, changing someone's role changes
						what the reports say their unpaid work pays.
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
