<script lang="ts">
	import LineForm from '#lib/LineForm.svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();
</script>

<LineForm {data} back={resolve('/invoices/[id]', { id: data.draft.id })} />
