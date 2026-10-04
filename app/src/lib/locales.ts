/**
 * Locales as reckon offers and stores them.
 *
 * A locale is how dates and figures read -- the language, the order of day and
 * month, the separators -- written as BCP 47 writes one: "en-GB". The business
 * has one, and each person may set their own in their profile, with a 12- or
 * 24-hour clock and the day their week starts over it.
 *
 * Stored as Intl canonicalises it, and only if Intl has data for it, so a
 * stored locale is always one that formats. The list offered is the common
 * ones; a stored value off the list is still shown, so a field never pretends
 * to hold something it does not.
 *
 * The same in the browser and on the server: everything here is Intl.
 */

/** What the profile and the business's settings offer, by BCP 47 tag. */
export const OFFERED = [
	'en-US',
	'en-GB',
	'en-CA',
	'en-AU',
	'en-NZ',
	'en-IE',
	'en-IN',
	'en-ZA',
	'es-US',
	'es-MX',
	'es-ES',
	'es-419',
	'fr-CA',
	'fr-FR',
	'fr-BE',
	'fr-CH',
	'de-DE',
	'de-AT',
	'de-CH',
	'it-IT',
	'pt-BR',
	'pt-PT',
	'nl-NL',
	'nl-BE',
	'sv-SE',
	'nb-NO',
	'da-DK',
	'fi-FI',
	'is-IS',
	'pl-PL',
	'cs-CZ',
	'sk-SK',
	'hu-HU',
	'ro-RO',
	'bg-BG',
	'hr-HR',
	'sl-SI',
	'sr-RS',
	'el-GR',
	'tr-TR',
	'ru-RU',
	'uk-UA',
	'he-IL',
	'ar-AE',
	'ar-SA',
	'fa-IR',
	'hi-IN',
	'bn-BD',
	'th-TH',
	'vi-VN',
	'id-ID',
	'ms-MY',
	'fil-PH',
	'zh-CN',
	'zh-TW',
	'zh-HK',
	'ja-JP',
	'ko-KR'
] as const;

/** `value` as Intl canonicalises it, if it is a locale Intl can format in; else null. */
export function pickLocale(value: string): string | null {
	const v = value.trim();
	if (!v || v.length > 35) return null;
	try {
		const [tag] = Intl.getCanonicalLocales(v);
		return tag && Intl.DateTimeFormat.supportedLocalesOf([tag]).length ? tag : null;
	} catch {
		return null;
	}
}

/** A locale's name in the language given: "German (Germany)" in English. */
function nameIn(lang: string, tag: string): string {
	try {
		return (
			new Intl.DisplayNames([lang], { type: 'language', languageDisplay: 'standard' }).of(tag) ??
			tag
		);
	} catch {
		return tag;
	}
}

/** "English (United Kingdom)"; "German (Germany) — Deutsch (Deutschland)". */
export function localeName(tag: string): string {
	const [english, own] = [nameIn('en', tag), nameIn(tag, tag)];
	return own === english ? english : `${english} — ${own}`;
}

let listed: { value: string; label: string }[] | null = null;
/**
 * The list for a field holding `current`, sorted by English name, the language
 * the screens are in. A stored locale off
 * the list is kept at the top; `blank` adds an empty choice at the head,
 * labelled as given.
 */
export function localeOptions(
	current: string | null,
	blank?: string
): { value: string; label: string }[] {
	listed ??= OFFERED.map((tag) => ({ tag, key: nameIn('en', tag) }))
		.sort((a, b) => a.key.localeCompare(b.key, 'en'))
		.map(({ tag }) => ({ value: tag, label: localeName(tag) }));
	const extra =
		current && !listed.some((l) => l.value === current)
			? [{ value: current, label: localeName(current) }]
			: [];
	return [...(blank === undefined ? [] : [{ value: '', label: blank }]), ...extra, ...listed];
}

export type HourCycle = 'h12' | 'h23';

/**
 * The tag a person's figures are written with: their locale, with their clock
 * over it when they chose one -- Unicode's hc key, which Intl reads.
 */
export function localeTag(locale: string, hourCycle: HourCycle | null): string {
	if (!hourCycle) return locale;
	try {
		return new Intl.Locale(locale, { hourCycle }).toString();
	} catch {
		return locale;
	}
}

/** The day a locale starts its week on, 1 for Monday to 7 for Sunday. */
export function weekStartOf(locale: string): number {
	try {
		const l = new Intl.Locale(locale) as Intl.Locale & {
			getWeekInfo?: () => { firstDay: number };
			weekInfo?: { firstDay: number };
		};
		return l.getWeekInfo?.().firstDay ?? l.weekInfo?.firstDay ?? 1;
	} catch {
		return 1;
	}
}
