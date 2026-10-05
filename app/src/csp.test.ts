import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The one style attribute the content security policy admits is SvelteKit's
 * route announcer's, by its hash. The hash is of SvelteKit's source, so it is
 * worked out again here from the version installed: an upgrade that changes the
 * announcer's style fails this rather than leaving the announcer's text on show
 * after every navigation.
 */
describe('the content security policy', () => {
	it("admits the route announcer's style attribute, and only that one", () => {
		const kit = dirname(createRequire(import.meta.url).resolve('@sveltejs/kit/package.json'));
		const root = readFileSync(join(kit, 'src/runtime/components/root.svelte'), 'utf8');
		const announcer = /id="svelte-announcer"[^>]*?style="([^"]*)"/s.exec(root);
		expect(announcer, 'the announcer has a style attribute in root.svelte').not.toBeNull();
		const hash = createHash('sha256').update(announcer![1]).digest('base64');

		const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
		// However the formatter wraps it: the directive, 'unsafe-hashes', and this
		// hash, and nothing else in the list.
		const directive = new RegExp(
			String.raw`'style-src-attr':\s*\[\s*'unsafe-hashes',\s*'sha256-` +
				hash.replace(/[+/=]/g, (c) => `\\${c}`) +
				String.raw`'\s*\]`
		);
		expect(config).toMatch(directive);
	});

	// The Maps JavaScript API, for the address field, and nothing more of
	// Google's: its scripts, and its requests for places.
	it("admits Google's address lookup, and no more than it uses", () => {
		const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
		const sources = (directive: string) =>
			(new RegExp(String.raw`'${directive}':\s*\[([^\]]*)\]`).exec(config)?.[1] ?? '')
				.split(',')
				.map((s) => s.trim().replace(/^'|'$/g, ''))
				.filter(Boolean);
		expect(sources('script-src')).toEqual(['self', 'https://maps.googleapis.com']);
		expect(sources('connect-src')).toEqual([
			'self',
			'https://maps.googleapis.com',
			'https://places.googleapis.com'
		]);
		// In no directive -- the comments may say why not.
		const every = [...config.matchAll(/'[a-z-]+':\s*\[([^\]]*)\]/g)].map((m) => m[1]).join(',');
		expect(every).not.toMatch(/unsafe-eval|unsafe-inline/);
	});

	// With loading=async the script's load event says nothing about whether the
	// API is ready; the callback does.
	it('waits for the Maps API to say it is ready', () => {
		const loader = readFileSync(new URL('./lib/google.ts', import.meta.url), 'utf8');
		expect(loader).toMatch(/maps\.googleapis\.com\/maps\/api\/js\?/);
		expect(loader).toMatch(/&callback=\$\{READY\}/);
		expect(loader).not.toMatch(/script\.onload/);
	});
});
