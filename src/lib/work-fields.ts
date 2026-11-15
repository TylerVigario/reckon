// What a piece of work is, as a timer is started and an entry entered or
// changed (#lib/WorkFields), and what in it stops it being saved.

export type Work = {
	entityId: string | null;
	siteId: string | null;
	serviceId: string | null;
	crew: 'one' | 'team';
	workedBy: string | null;
	crewIds: string[];
	billable: boolean;
	note: string;
};

/**
 * Why the work as filled in cannot be saved, by the field to say it under:
 * nothing when it can. `now` is a timer being started, said in the present.
 */
export function workErrors(w: Work, now: boolean): Record<string, string> {
	const errors: Record<string, string> = {};
	if (w.billable && !w.entityId)
		errors.entity_id = 'Billable work needs somebody to bill. Pick who pays, or untick Billable.';
	if (!w.serviceId) errors.service_id = now ? 'What is being done.' : 'What was done.';
	if (w.crew === 'one' && !w.workedBy)
		errors.worked_by = now ? 'Who is working.' : 'Who worked it.';
	if (w.crew === 'team' && w.crewIds.length < 2)
		errors.crew_ids = `A team is two or more. Tick who else ${now ? 'is' : 'was'} on it, or pick one person.`;
	return errors;
}

/**
 * Takes the eye, and the keyboard, to the first field a save was refused for,
 * as Primer's forms do when there is no summary of errors: a field marked
 * aria-invalid, the first choice in a group marked data-invalid, whose
 * message is the group's, or a button marked so, which is what puts it right.
 */
export function focusFirstInvalid(form: HTMLElement | null) {
	const field = form?.querySelector<HTMLElement>(
		'[aria-invalid="true"], fieldset[data-invalid] input:not([disabled]), button[data-invalid]'
	);
	field?.focus();
	field?.scrollIntoView({ block: 'center' });
}
