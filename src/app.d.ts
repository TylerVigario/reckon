import type { SessionUser } from '#lib/server/auth.ts';
import type { Theme } from '#lib/device-fields.ts';

declare global {
	namespace App {
		interface Locals {
			/** Set by hooks.server.ts. Null only on a route in OPEN. */
			user: SessionUser | null;
			/** The session this browser is signed in with, by its id. Set with `user`. */
			sessionId: string | null;
			/**
			 * The person's time zone: their own, or the business's until they set
			 * it. Set by hooks.server.ts on every request (#lib/server/calendar).
			 */
			zone: string;
			/** The business's time zone, the operator's. Set by hooks.server.ts. */
			businessZone: string;
			/**
			 * How figures read for this person (#lib/format): their locale, or the
			 * business's until they set one, with their clock over it -- "en-GB",
			 * "en-US-u-hc-h23". Set by hooks.server.ts.
			 */
			locale: string;
			/** The business's locale: the default for people, and for documents. */
			businessLocale: string;
			/** The day this person's week starts, 1 for Monday to 7 for Sunday. */
			weekStart: number;
			/** The business's currency, which sets every amount's places (#lib/currency). */
			currency: string;
			/** Light or dark as this device is set, or null for its own (#lib/device-fields). */
			theme: Theme | null;
		}
	}
}

export {};
