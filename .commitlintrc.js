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
