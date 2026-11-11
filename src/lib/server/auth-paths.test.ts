import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ building: false }));
vi.mock('$app/env/private', () => ({
	BETTER_AUTH_SECRET: 'a-secret-for-these-tests-and-nothing-else',
	BETTER_AUTH_SECRET_FILE: undefined,
	PWNED_PASSWORDS_URL: undefined,
	SECURE_COOKIES: true,
	SITE_URL: 'https://reckon.kestrel.example'
}));
vi.mock('$app/server', () => ({ getRequestEvent: () => undefined }));
vi.mock('./db/index.ts', () => ({ db: {}, schema: {} }));

const { getAuth } = await import('./auth.ts');
const { CLOSED_AUTH_PATHS, OPEN_AUTH_PATHS, UNCLOSED_AUTH_PATHS } = await import('./auth-paths.ts');

/** Every route the configured Better Auth answers over HTTP, plugins included. */
const served = () =>
	[
		...new Set(
			Object.values(getAuth().api)
				.map((e) => (e as { path?: string }).path)
				.filter((p): p is string => !!p)
		)
	].sort();

describe("Better Auth's routes", () => {
	const reviewed = [...OPEN_AUTH_PATHS, ...CLOSED_AUTH_PATHS, ...Object.keys(UNCLOSED_AUTH_PATHS)];

	it('are each open, closed, or named as unclosable, and none is left unreviewed', () => {
		expect(served().filter((p) => !reviewed.includes(p))).toEqual([]);
	});

	it('are listed only where they exist, so a route gone or renamed is noticed', () => {
		expect(reviewed.filter((p) => !served().includes(p))).toEqual([]);
	});

	it('are each listed once', () => {
		expect(reviewed.filter((p, i) => reviewed.indexOf(p) !== i)).toEqual([]);
	});

	it('are unclosable only where disabledPaths cannot name them, having a parameter', () => {
		expect(Object.keys(UNCLOSED_AUTH_PATHS).every((p) => p.includes(':'))).toBe(true);
		expect(CLOSED_AUTH_PATHS.some((p) => p.includes(':'))).toBe(false);
	});

	it('are the ones Better Auth is told to turn away', () => {
		expect([...(getAuth().options.disabledPaths ?? [])].sort()).toEqual(
			[...CLOSED_AUTH_PATHS].sort()
		);
	});
});
