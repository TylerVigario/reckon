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
			 * What the browser is allowed to load, which for this app is: what
			 * it was served, and nothing else.
			 *
			 * Nothing here talks to a third party from the browser -- CDTFA and
			 * Google are called from the server, the fonts are vendored from
			 * press and served from this origin -- so 'self' is not a
			 * compromise, it is the truth. A policy loose enough to never
			 * complain is a policy that stops an attack never.
			 *
			 * mode 'auto' lets SvelteKit hash or nonce its own inline bits
			 * rather than being handed 'unsafe-inline', which would defeat the
			 * script directive entirely.
			 */
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self'],
					'img-src': ['self', 'data:'],
					'font-src': ['self'],
					// The server does the talking to CDTFA and Google. A fetch
					// from the page to anywhere but here is not something this
					// app does.
					'connect-src': ['self'],
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
	 * green typecheck proved nothing about runtime, a 200 proved nothing about
	 * rendering, and a GET proved nothing about writes. What this adds is the
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
		environment: 'node'
	}
});
