import { SECURE_COOKIES } from '$app/env/private';
import { DEVICE_FIELDS, THEME_COOKIE, parseDeviceField } from '#lib/device-fields.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/** As long as a browser keeps a cookie: RFC 6265bis caps an expiry at 400 days. */
const KEPT = 60 * 60 * 24 * 400;

/**
 * What this device is set to (#lib/device-fields): its theme. It is kept in a
 * cookie on the device that asked, so it reaches no other. Empty takes the
 * cookie away, and the device's own setting decides again.
 */
export const PATCH: RequestHandler = async ({ request, cookies }) => {
	const fields = await readFields(request);
	const names = fields ? Object.keys(fields) : [];
	if (!fields || names.length !== 1 || !(names[0] in DEVICE_FIELDS))
		return problem(
			'malformed',
			400,
			`Expected { fields: { one of ${Object.keys(DEVICE_FIELDS).join(', ')}: value } }.`
		);

	const raw = fields.theme;
	const parsed = parseDeviceField('theme', typeof raw === 'string' ? raw : '');
	if (!parsed.ok) return refuse({ theme: parsed.why });
	const value = parsed.value as string | null;

	// Only the server reads it, and it is Secure as the session cookie is.
	const kept = { path: '/', httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES } as const;
	if (value === null) cookies.delete(THEME_COOKIE, kept);
	else cookies.set(THEME_COOKIE, value, { ...kept, maxAge: KEPT });
	return Response.json({ saved: { theme: value } });
};
