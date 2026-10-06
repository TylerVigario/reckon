<script lang="ts">
	import LineForm from '#lib/LineForm.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
</script>

<LineForm
	{data}
	editing={data.editing}
	back={resolve('/invoices/[id]/lines/[line]', { id: data.draft.id, line: data.editing.id })}
/>
