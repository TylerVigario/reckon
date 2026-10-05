import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node, because this is self-hosted: it emits a standalone
			// server the host runs behind whatever reverse proxy it already
			// has. adapter-auto detects none of the platforms it knows and
			// builds an unrunnable bundle with a warning.
			adapter: adapter(),

			/**
			 * What the browser is allowed to load: what this origin served, and
			 * nothing else. CDTFA and Google's server-side checks are called from
			 * the server, and the fonts are vendored from press and served from
			 * here.
			 *
			 * Google's address lookup is the exception, and admitted as narrowly
			 * as it works (#lib/google): the Maps JavaScript API's scripts from
			 * maps.googleapis.com, and its requests to maps.googleapis.com and
			 * places.googleapis.com. Not the whole of Google's published list,
			 * which is for drawing maps -- none is drawn here -- and asks for
			 * 'unsafe-eval' and inline styles besides.
			 *
			 * mode 'auto' lets SvelteKit hash or nonce its own inline bits
			 * rather than being handed 'unsafe-inline', which would defeat the
			 * script directive entirely.
			 */
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self', 'https://maps.googleapis.com'],
					'style-src': ['self'],
					// No style attribute is admitted but one: SvelteKit's route
					// announcer, which hides itself with one and would otherwise
					// show its text after every client-side navigation
					// (sveltejs/kit#15220). 'unsafe-hashes' with its hash admits
					// that exact attribute and nothing else, where the usual
					// workaround, 'unsafe-inline', admits every inline style.
					// src/csp.test.ts re-hashes it from SvelteKit's own source, so
					// an upgrade that changes it fails CI rather than the page.
					'style-src-attr': [
						'unsafe-hashes',
						'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo='
					],
					'img-src': ['self', 'data:'],
					'font-src': ['self'],
					'connect-src': ['self', 'https://maps.googleapis.com', 'https://places.googleapis.com'],
					'form-action': ['self'],
					'base-uri': ['none'],
					'object-src': ['none'],
					// Nothing frames this. X-Frame-Options says the same thing
					// to browsers that predate the directive.
					'frame-ancestors': ['none']
				}
			}
		})
	],

	/**
	 * Unit tests, for the parts that are pure.
	 *
	 * NOT a substitute for the harnesses in scripts/. Those exist because a
	 * green typecheck proves nothing about runtime, a 200 nothing about
	 * rendering, and a GET nothing about writes. What this adds is the
	 * layer underneath: rules that decide what a value may be, and the contract
	 * with CDTFA -- things with no database and no browser in them, where a
	 * test can state the rule and fail in milliseconds when it changes.
	 *
	 * Node, not jsdom: nothing under test touches a DOM. A component test would
	 * need vitest-browser-svelte and a real browser, which is a decision for
	 * when there is a component worth testing that way.
	 */
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// Temporal, as hooks.server.ts and hooks.client.ts provide it to the app.
		setupFiles: ['temporal-polyfill/global']
	}
});
