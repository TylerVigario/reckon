/**
 * Lets a plain node script import the app's TypeScript modules.
 *
 * Node 24 strips types by itself, so the only thing in the way is that
 * TypeScript writes `./field-rules` where ESM wants `./field-rules.ts`. This
 * adds the extension when the bare specifier does not resolve.
 *
 * Used by schema-check.mjs so it can read the SAME registry objects the app
 * does. A checker that parsed the source, or held its own copy of the rules,
 * would be a third statement of them -- and a third thing that can disagree.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
	'data:text/javascript,' +
		encodeURIComponent(`
	export async function resolve(specifier, context, next) {
		try {
			return await next(specifier, context);
		} catch (e) {
			if (specifier.startsWith('.') && !/\\.[a-z]+$/.test(specifier)) {
				return next(specifier + '.ts', context);
			}
			throw e;
		}
	}
`),
	pathToFileURL('./')
);
