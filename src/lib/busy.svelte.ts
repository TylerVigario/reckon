import type { Attachment } from 'svelte/attachments';

/**
 * A BUTTON THAT IS WORKING -- saving, sending, making a passkey -- is drawn as
 * Primer's loading Button: "don't remove them from the DOM or add disabled to
 * avoid disrupting focus and keyboard navigation. Instead, add
 * aria-disabled="true" to indicate the loading state" (primer.style, Button,
 * accessibility). So it keeps its focus and its place, a spinner stands where
 * its label was (#lib/primer.css), a second press does nothing -- the press is
 * refused before anything else hears it, Enter in a field included, since that
 * presses the form's button -- and what it is doing is said, once, in the live
 * region the root layout keeps from the first paint: "Include a visually
 * hidden, ARIA live region (using aria-live="polite") message like "Saving
 * profile"". The message is there only while the button works.
 *
 *     <button class="btn pri" {@attach busy(saving && 'Saving the entry')}>Save</button>
 */
export const working = $state({ said: '' });

export function busy(said: string | false | null | undefined): Attachment<HTMLElement> {
	return (node) => {
		if (!said) return;
		const refuse = (e: Event) => {
			e.preventDefault();
			e.stopImmediatePropagation();
		};
		node.setAttribute('aria-disabled', 'true');
		node.dataset.loading = 'true';
		node.addEventListener('click', refuse, true);
		working.said = said;
		return () => {
			node.removeAttribute('aria-disabled');
			delete node.dataset.loading;
			node.removeEventListener('click', refuse, true);
			if (working.said === said) working.said = '';
		};
	};
}
