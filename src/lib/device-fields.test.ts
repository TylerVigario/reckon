import { describe, expect, it } from 'vitest';
import { parseDeviceField, themeFrom } from './device-fields.ts';

describe('a theme', () => {
	it('is light, dark, or left to the device', () => {
		expect(parseDeviceField('theme', 'light')).toEqual({ ok: true, value: 'light' });
		expect(parseDeviceField('theme', 'dark')).toEqual({ ok: true, value: 'dark' });
		expect(parseDeviceField('theme', '')).toEqual({ ok: true, value: null });
		expect(parseDeviceField('theme', 'sepia').ok).toBe(false);
	});

	// The cookie's value is written into <html>, so nothing else in it may reach the page.
	it("is read from a cookie as one of the two, and anything else as the device's own", () => {
		expect(themeFrom('light')).toBe('light');
		expect(themeFrom('dark')).toBe('dark');
		expect(themeFrom(undefined)).toBeNull();
		expect(themeFrom('dark" onload="x')).toBeNull();
	});
});
