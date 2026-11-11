<script lang="ts">
	import Top from '#lib/Top.svelte';
	import UnderlineNav from '#lib/UnderlineNav.svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	/**
	 * Your profile, and its tabs: Profile, how dates and figures read and the
	 * address you sign in with, and Passkeys -- each its own address (Primer's
	 * UnderlineNav: "Use the UnderlineNav component when activating a tab
	 * changes the URL"). Only the tabs are drawn to Primer here (#lib/primer.css).
	 */
	let { data, children }: LayoutProps = $props();
</script>

<Top title="Your profile" sub={data.user?.name ?? ''} back={resolve('/more')} backLabel="More" />

<div class="pad">
	<div class="primer">
		<UnderlineNav
			label="Your profile"
			items={[
				{ href: resolve('/profile'), label: 'Profile', current: page.route.id === '/profile' },
				{
					href: resolve('/profile/passkeys'),
					label: 'Passkeys',
					count: data.passkeys,
					current: page.route.id === '/profile/passkeys'
				}
			]}
		/>
	</div>
	{@render children()}
</div>
