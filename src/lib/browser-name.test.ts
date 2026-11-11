import { describe, expect, it } from 'vitest';
import { browserName } from './browser-name.ts';

describe('a browser', () => {
	it.each([
		[
			'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
			'Chrome on Android'
		],
		[
			'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1',
			'Safari on iPhone'
		],
		[
			'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1',
			'Chrome on iPhone'
		],
		[
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
			'Edge on Windows'
		],
		[
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
			'Safari on Mac'
		],
		['Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0', 'Firefox on Linux'],
		[
			'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
			'Samsung Internet on Android'
		]
	])('is named by what it is and what it runs on: %#', (agent, name) => {
		expect(browserName(agent)).toBe(name);
	});

	it('that says nothing recognisable is not named', () => {
		expect(browserName('curl/8.11.1')).toBeNull();
		expect(browserName(null)).toBeNull();
		expect(browserName('')).toBeNull();
	});
});
