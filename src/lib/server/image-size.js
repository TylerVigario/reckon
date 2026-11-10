// An image's width and height in pixels, read from the file's own header, so
// no image library is shipped for it; null for a file that is not what it
// says. Plain JavaScript, so scripts/user.mjs reads a logo's size as the server
// does.

/** @typedef {{ width: number, height: number }} Size */

/**
 * A PNG's, from the IHDR chunk that must come first.
 *
 * @param {Uint8Array} b
 * @returns {Size | null}
 */
export function pngSize(b) {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (b.length < 24 || signature.some((v, i) => b[i] !== v)) return null;
	if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * A JPEG's, from its first start-of-frame marker (ITU T.81 B.2.2): the
 * segments before it are stepped over by their own lengths.
 *
 * @returns {Size | null}
 */
export function jpegSize(/** @type {Uint8Array} */ b) {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let at = 2;
	while (at + 9 < b.length) {
		if (b[at] !== 0xff) return null;
		const marker = b[at + 1];
		// Fill bytes, and the markers that carry no length.
		if (marker === 0xff) {
			at += 1;
			continue;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			at += 2;
			continue;
		}
		const length = view.getUint16(at + 2);
		// SOF0 to SOF15, but for DHT (C4), JPG (C8) and DAC (CC).
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			const height = view.getUint16(at + 5);
			const width = view.getUint16(at + 7);
			return width && height ? { width, height } : null;
		}
		at += 2 + length;
	}
	return null;
}
