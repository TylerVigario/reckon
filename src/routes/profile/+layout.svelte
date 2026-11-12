<script lang="ts">
	import Top from '#lib/Top.svelte';
	import RecordHead from '#lib/RecordHead.svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	/**
	 * Your profile, and its tabs: Profile, how dates and figures read and the
	 * address you sign in with; Passkeys; and Security log, a year of what
	 * happened to how you sign in -- each its own address (Primer's
	 * UnderlineNav: "Use the UnderlineNav component when activating a tab
	 * changes the URL"), under the head every record with tabs shares
	 * (#lib/RecordHead). Only the tabs are drawn to Primer here (#lib/primer.css).
	 */
	let { data, children }: LayoutProps = $props();
</script>

<Top title="Your profile" sub={data.user?.name ?? ''} back={resolve('/more')} backLabel="More" />

<div class="pad">
	<RecordHead
		label="Your profile"
		tabs={[
			{ href: resolve('/profile'), label: 'Profile', current: page.route.id === '/profile' },
			{
				href: resolve('/profile/passkeys'),
				label: 'Passkeys',
				count: data.passkeys,
				current: page.route.id === '/profile/passkeys'
			},
			{
				href: resolve('/profile/security-log'),
				label: 'Security log',
				current: page.route.id === '/profile/security-log'
			}
		]}
	/>
	{@render children()}
</div>
