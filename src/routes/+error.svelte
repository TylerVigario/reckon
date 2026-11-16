<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Authentication from '#lib/Authentication.svelte';
	import Top from '#lib/Top.svelte';
	import { CLIENT_PAGE, LINK_PAGE } from '#lib/client-link.ts';

	/**
	 * What a screen that could not be shown says instead: where the shell is
	 * drawn (+layout.svelte), in it, as Primer's Blankslate with the way back to
	 * Today; where it is not -- a client's invoice link, an emailed link, anyone
	 * signed out -- as sign-in is drawn, under the business's mark. The heading
	 * is the error's first sentence and the rest is said under it, so an error
	 * nobody meant still shows the id it was logged with (hooks.server.ts).
	 */
	const shell = $derived(
		!!page.data.user && !CLIENT_PAGE.test(page.url.pathname) && !LINK_PAGE.test(page.url.pathname)
	);
	const message = $derived(page.error?.message?.trim() || 'Something went wrong');
	const cut = $derived(message.search(/\.(\s|$)/));
	const first = $derived(cut === -1 ? message : message.slice(0, cut));
	const heading = $derived(first.charAt(0).toUpperCase() + first.slice(1));
	const rest = $derived(cut === -1 ? '' : message.slice(cut + 1).trim());
</script>

<svelte:head><title>{heading}</title></svelte:head>

{#if shell}
	<Top title={page.status === 404 ? 'Not found' : 'Something went wrong'} />
	<div class="pad">
		<section class="box" aria-labelledby="error-h">
			<div class="blank">
				<h2 class="blank-h" id="error-h">{heading}</h2>
				{#if rest}<p class="blank-d">{rest}</p>{/if}
				<a class="btn pri" href={resolve('/')}>Today</a>
			</div>
		</section>
	</div>
{:else}
	{#if rest}
		<Authentication title={heading}><p>{rest}</p></Authentication>
	{:else}
		<Authentication title={heading} />
	{/if}
{/if}
