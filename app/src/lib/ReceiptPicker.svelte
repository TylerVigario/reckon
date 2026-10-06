<script lang="ts">
	import { asDataUrl } from './receipt.ts';

	/**
	 * A receipt chosen as a form's file: a tile that is the input's label, so a
	 * tap opens the phone's camera or its files, with the photo shown once it is
	 * chosen. The input itself is out of sight but still in the form, and the
	 * form shrinks a photo before it is sent (#lib/receipt).
	 */
	let { id, name = 'receipt' }: { id: string; name?: string } = $props();

	let preview = $state<string | null>(null);
	let chosen = $state<string | null>(null);
	async function pick(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		chosen = file?.name ?? null;
		preview =
			file && file.type.startsWith('image/') ? await asDataUrl(file).catch(() => null) : null;
	}
</script>

<div class="picker">
	<div class="shots">
		{#if preview}
			<img class="thumb" src={preview} alt="The receipt chosen" />
		{:else if chosen}
			<span class="thumb doc">{chosen}</span>
		{/if}
		<label class="addshot" for={id}>
			<span class="plus" aria-hidden="true">+</span>
			<span>{chosen ? 'Another' : 'Photo or file'}</span>
		</label>
	</div>
	<input
		{id}
		{name}
		class="hidden-file"
		type="file"
		accept="image/*,application/pdf"
		onchange={pick}
	/>
</div>

<style>
	.picker {
		position: relative;
	}
	.shots {
		display: flex;
		gap: 10px;
	}
	.thumb,
	.addshot {
		width: 92px;
		height: 122px;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--line);
		flex: none;
		box-sizing: border-box;
	}
	img.thumb {
		object-fit: cover;
	}
	.thumb.doc {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 8px;
		font-size: 11px;
		overflow-wrap: anywhere;
		text-align: center;
		color: var(--ink-2);
	}
	.addshot {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		background: var(--surface-2);
		border-style: dashed;
		color: var(--ink-2);
		font-size: 12px;
		cursor: pointer;
	}
	/* Keyboard focus is on the input out of sight; it shows on the tile. */
	.picker:has(.hidden-file:focus-visible) .addshot {
		outline: 2px solid var(--accent);
	}
	.plus {
		font-size: 24px;
		line-height: 1;
		color: var(--accent);
	}
	.hidden-file {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
</style>
