<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { clock, datedAt, todayIn } from '#lib/format.ts';
	import { personalZone } from '#lib/zone.svelte.ts';

	/**
	 * Says, at the top of a screen that works with no signal, that it has none,
	 * how old what it shows is (#21), and what is waiting on this phone to send.
	 *
	 * OFFLINE IS THE SERVER OUT OF REACH, asked directly: a screen opened with no
	 * signal is drawn from the copy the service worker kept, and nothing in the
	 * copy says so -- one kept a minute ago looks fresh. The browser's own word,
	 * navigator.onLine, is believed only when it says offline: it says online on
	 * any network, reachable server or not. When the server is back the screen
	 * fetches itself again, so it stops showing the copy.
	 */
	let {
		asOf,
		waiting = 0
	}: {
		/** When the server made the data the screen shows. */
		asOf: string;
		/** How many changes are on this phone, waiting to send. */
		waiting?: number;
	} = $props();

	let reachable = $state(true);
	async function ask() {
		let answered = false;
		if (navigator.onLine)
			try {
				// A proxy answering for a server that is down is no server.
				answered = (await fetch('/api/reachable', { cache: 'no-store' })).status < 500;
			} catch {
				answered = false;
			}
		const back = answered && !reachable;
		reachable = answered;
		if (back) await invalidateAll();
	}
	onMount(() => {
		void ask();
		const again = () => void ask();
		addEventListener('online', again);
		addEventListener('offline', again);
		return () => {
			removeEventListener('online', again);
			removeEventListener('offline', again);
		};
	});

	const when = $derived.by(() => {
		const zone = personalZone();
		const at = Date.parse(asOf);
		return todayIn(zone, at) === todayIn(zone)
			? clock(at, zone)
			: `${datedAt(at, zone)}, ${clock(at, zone)}`;
	});
	const changes = $derived(`${waiting} ${waiting === 1 ? 'change' : 'changes'} waiting to send`);
</script>

{#if !reachable || waiting > 0}
	<div class="offline" role="status">
		<span aria-hidden="true">●</span>
		{#if !reachable}Offline · as of {when}{waiting > 0 ? ` · ${changes}` : ''}{:else}{changes}{/if}
	</div>
{/if}
