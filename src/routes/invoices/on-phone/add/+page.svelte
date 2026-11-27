<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import LineForm from '#lib/LineForm.svelte';
	import Top from '#lib/Top.svelte';
	import Octicon from '#lib/Octicon.svelte';
	import { findDraft, findLine } from '#lib/queue.ts';
	import type { ResolvedPathname } from '$app/types';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	/**
	 * Read from the queue, not loaded: a draft started here (?draft=), or a line
	 * refused for one that has since gone out (?fix=), which keeps the draft it
	 * was added to and its client.
	 */
	type For = {
		draft: { id: string; number: string | null; who: string; entity_id: string; gone?: boolean };
		back: ResolvedPathname;
	};
	let found = $state<For | null | undefined>(undefined);
	const uuid = $derived(page.url.searchParams.get('draft') ?? '');
	const fix = $derived(page.url.searchParams.get('fix'));
	onMount(() => {
		const read = async (): Promise<For | null> => {
			if (fix) {
				const q = await findLine(fix);
				return q
					? {
							draft: { ...q.line.draft, id: q.line.invoice_id, gone: true },
							back: resolve('/invoices')
						}
					: null;
			}
			const d = await findDraft(uuid);
			return d
				? {
						draft: { id: uuid, number: null, who: d.draft.who, entity_id: d.draft.entity_id },
						back: resolve(`/invoices/on-phone?draft=${encodeURIComponent(uuid)}`)
					}
				: null;
		};
		void read().then(
			(f) => (found = f),
			() => (found = null)
		);
	});
</script>

{#if found}
	<LineForm
		data={{
			...data,
			draft: found.draft,
			sites: data.sites.filter((s) => s.entity_id === found?.draft.entity_id)
		}}
		back={found.back}
	/>
{:else if found === null}
	<Top title="Add a line" back={resolve('/invoices')} backLabel="Invoices" />
	<div class="pad">
		<div class="banner" role="status">
			<Octicon name="info" />
			<div class="banner-m">
				<p class="banner-t why">
					{fix ? 'That line' : 'That draft'} is not on this phone. It may have reached the server already.
				</p>
			</div>
		</div>
	</div>
{/if}
