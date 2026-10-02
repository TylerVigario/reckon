/**
 * Whether the operator's logo can stand as the installed app's icon.
 *
 * An installed app is drawn from its manifest's icons, and a phone wants one at
 * least 512px square for its launcher and splash screen. A logo is the
 * operator's choice of file, so it is only offered as the icon when it is fit
 * to be one: an SVG drawn square, which scales to any size, or a PNG at least
 * 512px and square. Anything else -- a wide wordmark, a small or a JPEG logo --
 * leaves the default icon in place rather than stretching or blurring theirs.
 *
 * Read from the file's own header, so no image library is shipped for it.
 */
export type IconFit = { type: string; sizes: string };

const SMALLEST = 512;

export function iconFromLogo(bytes: Uint8Array, mediaType: string | null): IconFit | null {
	if (mediaType === 'image/png') {
		const size = pngSize(bytes);
		if (size && size.width === size.height && size.width >= SMALLEST)
			return { type: 'image/png', sizes: `${size.width}x${size.height}` };
		return null;
	}
	if (mediaType === 'image/svg+xml') {
		return svgIsSquare(new TextDecoder().decode(bytes))
			? { type: 'image/svg+xml', sizes: 'any' }
			: null;
	}
	return null;
}

/** A PNG's width and height, from the IHDR chunk that must come first. */
function pngSize(b: Uint8Array): { width: number; height: number } | null {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (b.length < 24 || signature.some((v, i) => b[i] !== v)) return null;
	if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Whether an SVG's drawing area is square, by its viewBox or its own size. */
function svgIsSquare(svg: string): boolean {
	const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
	if (!root) return false;
	const box =
		/\bviewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*["']/.exec(
			root
		);
	if (box) {
		const [w, h] = [Number(box[3]), Number(box[4])];
		return w > 0 && w === h;
	}
	const w = /\bwidth\s*=\s*["']\s*([\d.]+)(px)?\s*["']/.exec(root)?.[1];
	const h = /\bheight\s*=\s*["']\s*([\d.]+)(px)?\s*["']/.exec(root)?.[1];
	return !!w && w === h;
}
