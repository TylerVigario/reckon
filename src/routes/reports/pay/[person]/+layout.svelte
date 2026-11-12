<script lang="ts">
	import Top from '#lib/Top.svelte';
	import RecordHead from '#lib/RecordHead.svelte';
	import { sum } from '#lib/decimal.ts';
	import { money } from '#lib/money.svelte.ts';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	/**
	 * Someone's pay, and its tabs: Owed, what they are owed and the payment
	 * that pays it, and Paid, every payment made to them -- each its own
	 * address. Someone with Field opens their own, as Your pay, from More.
	 */
	let { data, children }: LayoutProps = $props();

	const field = $derived(data.user?.access === 'field');
	const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
	const owed = $derived(sum(data.items.map((i) => i.amount)));
	const person = $derived({ person: data.person.id });
</script>

{#if field}
	<Top title="Your pay" back={resolve('/more')} backLabel="More" />
{:else}
	<Top title="Pay {data.person.name}" back={resolve('/reports/pay')} backLabel="Pay" />
{/if}

<div class="pad">
	<RecordHead
		label={field ? 'Your pay' : `${data.person.name}’s pay`}
		tabs={[
			{
				href: resolve('/reports/pay/[person]', person),
				label: 'Owed',
				current: page.route.id === '/reports/pay/[person]'
			},
			{
				href: resolve('/reports/pay/[person]/paid', person),
				label: 'Paid',
				count: data.payments.length,
				current: page.route.id === '/reports/pay/[person]/paid'
			}
		]}
	>
		{#snippet state()}
			<span class="muted">
				{[
					data.items.length ? `${money(owed.toString())} owed` : 'Nothing owed',
					data.person.role ? `as ${an(data.person.role)}` : null
				]
					.filter(Boolean)
					.join(' · ')}
			</span>
		{/snippet}
	</RecordHead>

	{@render children()}
</div>
