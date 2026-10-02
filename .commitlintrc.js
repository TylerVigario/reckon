// Conventional Commits, as the specification fixes them and nothing more: the
// shared @vts/commitlint-config, which every repository here extends.
//
// What it enforces: a type and a subject, with `feat` and `fix` always accepted,
// the remaining nine of the familiar eleven as a starter set, and every type
// matched in any case -- the specification says the units of a commit MUST NOT be
// treated as case-sensitive. What it does not: case, length or punctuation. Those
// are style, the specification says nothing about them, and the same commit
// should not pass in one repository and fail in the next.
//
// WHICH TYPES SHIP is cliff.toml's question, not this file's, and the line it
// draws is whether the artifact changed.
export default {
	extends: ['@vts/commitlint-config']
};
