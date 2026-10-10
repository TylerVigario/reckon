/**
 * Asks the service worker to fetch the screens it keeps for no signal, now,
 * while there is one (src/service-worker): after a sign-in, and after the
 * queue has sent something those screens show. Nothing happens in a browser
 * without a worker.
 */
export function warm() {
	if (!('serviceWorker' in navigator)) return;
	void navigator.serviceWorker.ready
		.then((r) => r.active?.postMessage({ type: 'warm' }))
		.catch(() => {});
}
