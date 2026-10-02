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
});
