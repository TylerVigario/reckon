import type { ReceiptType } from './db/database.ts';
import { everyWord } from '#lib/every-word.ts';

/**
 * What a receipt sent with a line, or with goods received, may be. One list
 * for both, and the database's own type (receipt_type), so neither can take
 * what the column will not.
 */

/** What the phone sends is shrunk to well under this; the column holds no more. */
export const MAX_RECEIPT = 2 * 1024 * 1024;

/** A photo, as the phone shrinks it, or a supplier's PDF. */
export const RECEIPT_TYPES = everyWord<ReceiptType>()([
	'image/jpeg',
	'image/png',
	'image/webp',
	'application/pdf'
]);

export const isReceiptType = (type: string): type is ReceiptType =>
	(RECEIPT_TYPES as readonly string[]).includes(type);
