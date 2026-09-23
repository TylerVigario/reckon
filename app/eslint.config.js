import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * What the linter is here to catch, given what is already checked elsewhere.
 *
 * svelte-check already proves the types line up, and prettier already decides
 * where the line breaks go -- so a rule that duplicates either of those is
 * noise. What is left is the class of mistake that typechecks, formats, and
 * still does the wrong thing at runtime. This project has shipped several:
 * an awaited call that was never awaited, a `'true'` string handed to a
 * boolean column, a keyed each block whose key was not unique.
 *
 * That is why this is TYPE-AWARE (recommendedTypeChecked, not recommended).
 * no-floating-promises and no-misused-promises need the checker to see a
 * Promise at all, and those two are the rules that would have caught the
 * queue silently swallowing its own failures.
 */
export default defineConfig([
	globalIgnores(['build/', '.svelte-kit/', 'node_modules/', 'static/']),

	js.configs.recommended,
	ts.configs.recommendedTypeChecked,
	svelte.configs.recommended,

	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: {
				projectService: true,
				// Without this the checker will not open a .svelte file at all,
				// and every type-aware rule silently reports nothing there --
				// which reads exactly like a clean pass.
				extraFileExtensions: ['.svelte']
			}
		}
	},

	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: { parser: ts.parser }
		},
		rules: {
			// svelte-check is the authority inside a .svelte file and this is
			// not. svelte2tsx resolves a component's prop types across files;
			// svelte-eslint-parser does not, so `onversion={(v) => ...}` reads
			// as `any` here while svelte-check knows it is a string -- proven by
			// giving it a string method that does not exist and watching
			// svelte-check, alone, refuse it.
			//
			// A rule that reports 43 values as untyped when the typechecker has
			// typed all 43 is not a strict rule, it is a wrong one, and the
			// cost of a wrong one is that the real findings stop being read.
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-return': 'off'
		}
	},

	{
		// The scripts are run by node directly, never bundled.
		//
		// The unsafe-any family is off here for a different reason than in
		// .svelte: it is right, and not worth obeying. These parse the Chrome
		// DevTools Protocol and psql output -- wire formats belonging to other
		// programs, shaped by what was asked for. Their blast radius is a
		// failing check, loudly, in CI. Everything that stops a wrong VALUE
		// reaching the database still applies, because that is what they exist
		// to catch.
		files: ['scripts/**'],
		languageOptions: { globals: globals.node },
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-return': 'off'
		}
	},

	{
		rules: {
			// TypeScript already refuses an undefined name, and does it better:
			// it knows about ambient globals like `google`, which this rule
			// reports as undefined because no import declares them. Leaving both
			// on means a true statement from one and a false one from the other.
			'no-undef': 'off',

			// ON. Every link goes through resolve() from $app/paths, which is
			// typed against the route tree SvelteKit generates -- so
			// resolve('/clinets') and a '/clients/[id]' missing its id are both
			// build failures rather than 404s somebody finds later.
			//
			// The 33 literal hrefs it touched were busywork. The six that were
			// not are the reason: the sidebar rail, the tab bar, the More menu,
			// the Settings menu and Top's breadcrumbs are hand-kept lists of
			// paths, and nothing else checks them. smoke.mjs only visits routes
			// it is told about -- and it had itself gone blind on four screens
			// when slugs replaced ids, reporting "every route answered" while
			// opening none of them. This makes that class of drift a type error.
			//
			// Top.svelte is the one exception, disabled inline at two lines: a
			// shared component never holds a route literal, so resolve() cannot
			// pick an overload there. Its callers resolve instead, and its props
			// are ResolvedPathname, which refuses anything that is not a real
			// route.
			'svelte/no-navigation-without-resolve': 'error',

			// An unused argument that exists to name a position is not a
			// mistake; an unused one prefixed with _ is the convention for
			// saying so out loud.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			]
		}
	},

	// Last, so it wins: everything prettier has an opinion about, the linter
	// has none. Two tools disagreeing about a line break is a fight with no
	// winner and a permanently red build.
	prettier,
	svelte.configs.prettier
]);
