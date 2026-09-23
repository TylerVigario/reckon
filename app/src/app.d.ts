import type { SessionUser } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			/** Set by hooks.server.ts. Null only on a route in OPEN. */
			user: SessionUser | null;
		}
	}
}

export {};
