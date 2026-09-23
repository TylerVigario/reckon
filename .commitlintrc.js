// Conventional Commits. The type carries release impact; the scope says where.
//
// THE TYPE SET IS NOT DECLARED HERE. @commitlint/config-conventional already
// ships the Angular types, and restating them would be a second copy to keep in
// step with upstream for nothing — rule 2 of the repository standard puts it as
// "no repository declares an enum, since declaring one restates a default."
//
// WHICH TYPES SHIP is cliff.toml's question, not this file's, and the line it
// draws is whether the artifact changed.
export default {
	extends: ['@commitlint/config-conventional'],

	rules: {
		// No inherited default exists for this one.
		'scope-case': [2, 'always', 'lower-case'],

		// Sentence case allowed; Title Case and UPPER CASE still refused.
		//
		// config-conventional forbids all four, and under rule 3 the pull request
		// title IS the commit -- so the rule runs against titles this repository
		// does not write. Dependabot's are sentence-case ("Bump the application
		// group in /app with 4 updates") and cannot be configured otherwise, and
		// `Validate PR title` is a required context. Inherited, the rule makes
		// every dependency update unmergeable for ever, which is rule 12's
		// updates switched on and then gated shut.
		'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],

		// 120 rather than the inherited 100. Under squash the pull request title
		// becomes the whole commit, and a type and scope eat the budget before
		// the subject starts.
		'header-max-length': [2, 'always', 120],

		// Escalated from warning: a body running into the subject line is a
		// malformed commit, not a style preference.
		'body-leading-blank': [2, 'always'],

		// Off rather than the inherited 100. Bodies here carry reasoning and
		// pasted output; wrapping is the author's call.
		'body-max-line-length': [0],

		// The conventional-changelog parser treats any line-start `Word:` as a
		// trailer boundary, which false-fires on ordinary prose.
		'footer-leading-blank': [0],
		'footer-max-line-length': [0]
	}
};
