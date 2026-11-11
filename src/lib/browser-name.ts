/**
 * A browser as a person would name it, from what it says it is: "Chrome on
 * Android", "Safari on iPhone", "Edge on Windows". For a notice to say where a
 * passkey was added from, and a list of sessions to say which is which. Null
 * for one that says nothing recognisable.
 *
 * It reads only the few names that matter and nothing finer: a version or a
 * device model would be noise, and a user-agent can say anything. Order
 * matters, since Edge and Opera say Chrome too, and Chrome says Safari.
 */
const BROWSERS: [RegExp, string][] = [
	[/\bEdg(?:e|A|iOS)?\//, 'Edge'],
	[/\bOPR\/|\bOpera\b/, 'Opera'],
	[/\bSamsungBrowser\//, 'Samsung Internet'],
	[/\bFirefox\/|\bFxiOS\//, 'Firefox'],
	[/\bCriOS\/|\bChrome\//, 'Chrome'],
	[/\bVersion\/[\d.]+.*\bSafari\//, 'Safari']
];

const SYSTEMS: [RegExp, string][] = [
	[/\biPhone\b/, 'iPhone'],
	[/\biPad\b/, 'iPad'],
	[/\bAndroid\b/, 'Android'],
	[/\bCrOS\b/, 'ChromeOS'],
	[/\bWindows\b/, 'Windows'],
	[/\bMac OS X\b|\bMacintosh\b/, 'Mac'],
	[/\bLinux\b/, 'Linux']
];

export function browserName(userAgent: string | null | undefined): string | null {
	if (!userAgent) return null;
	const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
	const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
	if (browser && system) return `${browser} on ${system}`;
	return browser ?? system ?? null;
}
