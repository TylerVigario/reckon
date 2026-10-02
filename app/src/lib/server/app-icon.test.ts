import { describe, expect, it } from 'vitest';
import { iconFromLogo } from './app-icon.ts';

/** The first 24 bytes of a PNG of the given size: what the check reads. */
function png(width: number, height: number): Uint8Array {
	const b = new Uint8Array(24);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	const v = new DataView(b.buffer);
	v.setUint32(16, width);
	v.setUint32(20, height);
	return b;
}
const svg = (root: string) => new TextEncoder().encode(`${root}<rect/></svg>`);

describe('the operator logo as the app icon', () => {
	it('takes a square PNG of 512px or more, at its own size', () => {
		expect(iconFromLogo(png(512, 512), 'image/png')).toEqual({
			type: 'image/png',
			sizes: '512x512'
		});
		expect(iconFromLogo(png(1024, 1024), 'image/png')).toEqual({
			type: 'image/png',
			sizes: '1024x1024'
		});
	});

	it('refuses a PNG that is too small or not square', () => {
		expect(iconFromLogo(png(256, 256), 'image/png')).toBeNull();
		expect(iconFromLogo(png(1200, 400), 'image/png')).toBeNull();
	});

	it('refuses bytes that only claim to be a PNG', () => {
		expect(
			iconFromLogo(new TextEncoder().encode('not a png at all, honestly'), 'image/png')
		).toBeNull();
	});

	it('takes an SVG drawn square, at any size', () => {
		expect(iconFromLogo(svg('<svg viewBox="0 0 100 100">'), 'image/svg+xml')).toEqual({
			type: 'image/svg+xml',
			sizes: 'any'
		});
		expect(iconFromLogo(svg('<svg width="64" height="64">'), 'image/svg+xml')).not.toBeNull();
	});

	it('refuses a wide SVG, and any other kind of file', () => {
		expect(iconFromLogo(svg('<svg viewBox="0 0 400 100">'), 'image/svg+xml')).toBeNull();
		expect(iconFromLogo(png(512, 512), 'image/jpeg')).toBeNull();
		expect(iconFromLogo(png(512, 512), null)).toBeNull();
	});
});
