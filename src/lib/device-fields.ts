/**
 * What is set for a device rather than for a person.
 *
 * The theme stands in for the device's own light or dark setting, so it belongs
 * to the device as that setting does: a phone kept dark and a desk kept light
 * each keep their own, where a person's choice would carry one onto the other.
 *
 * It is a cookie in the browser rather than a column, so the server can draw the
 * first paint in it (hooks.server.ts). The content security policy runs no
 * inline script, and a script run after the page has painted would show the
 * other theme first.
 */
import { oneOf, optional, parseIn, type Parsed } from './field-rules.ts';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** The cookie the theme is kept in. */
export const THEME_COOKIE = 'theme';

export const DEVICE_FIELDS = {
	// Empty follows the device.
	theme: optional(oneOf(THEMES))
};

export function parseDeviceField(field: string, raw: string): Parsed {
	return parseIn(DEVICE_FIELDS, field, raw);
}

/** The theme a cookie holds, or null for anything else: the device's own. */
export function themeFrom(value: string | undefined): Theme | null {
	return (THEMES as readonly string[]).includes(value ?? '') ? (value as Theme) : null;
}
