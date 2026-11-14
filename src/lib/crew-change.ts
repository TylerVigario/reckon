/**
 * WHO A SAVE CHANGES ON A TEAM ENTRY'S CREW: who leaves it and who joins it,
 * and no one else, so the entry's history says who was taken off and who was
 * put on in the save that did it -- not everyone taken off and put back.
 */
export function crewChange(before: readonly string[], after: readonly string[]) {
	const was = new Set(before);
	const now = new Set(after);
	return {
		gone: [...was].filter((id) => !now.has(id)),
		joined: [...now].filter((id) => !was.has(id))
	};
}
