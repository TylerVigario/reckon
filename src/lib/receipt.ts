/**
 * A receipt as the phone sends it: a photo shrunk to what keeps it legible,
 * a PDF as it is.
 *
 * 1,600 pixels on the longest side reads a till receipt or an A4 invoice and
 * comes to a few hundred kilobytes, where a phone's camera makes several
 * megabytes. A picture this browser cannot open goes as it is, and the server
 * says whether it can take it.
 */
const LONGEST = 1600;

export async function shrink(file: File): Promise<File> {
	if (!file.type.startsWith('image/')) return file;
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return file;
	}
	const scale = Math.min(1, LONGEST / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.8));
	return blob ? new File([blob], 'receipt.jpg', { type: 'image/jpeg' }) : file;
}

/** A file as a data: URL, which the page's policy lets an image show. */
export const asDataUrl = (file: Blob) =>
	new Promise<string>((done, fail) => {
		const reader = new FileReader();
		reader.onload = () =>
			typeof reader.result === 'string' ? done(reader.result) : fail(new Error('not read'));
		reader.onerror = () => fail(reader.error ?? new Error('not read'));
		reader.readAsDataURL(file);
	});
