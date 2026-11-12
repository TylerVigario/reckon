import { waitingCount } from './queue.ts';
import { running } from './timers.ts';

/**
 * SIGNING OUT WITH WORK STILL ON THE PHONE (12 November 2026). Unsent work is
 * its maker's, and signing out leaves it where it is (#lib/owner): it goes the
 * next time they sign in here. So signing out, from either place it is offered,
 * first says what is waiting, and goes ahead once they say so -- never deleting
 * any of it, and never refusing them.
 *
 * Asked: how much is waiting and how many timers run, and the form to send;
 * null form, nothing asked. The root layout draws the question.
 */
export const signingOut = $state<{ waiting: number; timers: number; form: HTMLFormElement | null }>(
	{
		waiting: 0,
		timers: 0,
		form: null
	}
);

let sure = false;

/** A sign-out form's submit: through at once with nothing waiting, asked first otherwise. */
export async function beforeSigningOut(event: SubmitEvent) {
	if (sure) {
		sure = false;
		return;
	}
	event.preventDefault();
	const form = event.currentTarget as HTMLFormElement;
	const waiting = await waitingCount().catch(() => 0);
	const timers = running().length;
	if (!waiting && !timers) return send(form);
	Object.assign(signingOut, { waiting, timers, form });
}

/** They said so: out, with their work left on the phone. */
export function signOutAnyway() {
	const form = signingOut.form;
	signingOut.form = null;
	if (form) send(form);
}

/** They stay signed in. */
export function stay() {
	signingOut.form = null;
}

function send(form: HTMLFormElement) {
	sure = true;
	form.requestSubmit();
}
