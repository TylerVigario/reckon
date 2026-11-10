import { describe, expect, it } from 'vitest';
import { jpegSize, pngSize } from './image-size.js';

/** A JPEG's first bytes: SOI, an APP0 segment to step over, then SOF0. */
const jpeg = (width: number, height: number, sof = 0xc0) =>
	Uint8Array.from([
		0xff,
		0xd8,
		0xff,
		0xe0,
		0x00,
		0x10,
		0x4a,
		0x46,
		0x49,
		0x46,
		0x00,
		0x01,
		0x01,
		0x00,
		0x00,
		0x01,
		0x00,
		0x01,
		0x00,
		0x00,
		0xff,
		sof,
		0x00,
		0x11,
		0x08,
		height >> 8,
		height & 0xff,
		width >> 8,
		width & 0xff,
		0x03,
		0x01,
		0x22,
		0x00,
		0x02,
		0x11,
		0x01,
		0x03,
		0x11,
		0x01
	]);

describe('an image’s size', () => {
	it('is read from a PNG’s header', () => {
		const png = Uint8Array.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2,
			0, 0, 0, 1, 0
		]);
		expect(pngSize(png)).toEqual({ width: 512, height: 256 });
	});

	it('is read from a JPEG’s first frame, past the segments before it', () => {
		expect(jpegSize(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
		// A progressive JPEG's frame is SOF2.
		expect(jpegSize(jpeg(1200, 300, 0xc2))).toEqual({ width: 1200, height: 300 });
	});

	it('is nothing for a file that is not what it says', () => {
		expect(pngSize(Uint8Array.from([1, 2, 3]))).toBeNull();
		expect(jpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
		// A DHT segment (C4) is not a frame, and has no size to read.
		expect(jpegSize(jpeg(640, 480, 0xc4))).toBeNull();
	});
});
