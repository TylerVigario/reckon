import type { SessionUser } from '#lib/server/auth.ts';

declare global {
	namespace App {
		interface Locals {
			/** Set by hooks.server.ts. Null only on a route in OPEN. */
			user: SessionUser | null;
			/**
			 * The person's time zone: their own, or the business's until they set
			 * it. Set by hooks.server.ts on every request (#lib/server/calendar).
			 */
			zone: string;
			/** The business's time zone, the operator's. Set by hooks.server.ts. */
			businessZone: string;
		}
	}
}

export {};
