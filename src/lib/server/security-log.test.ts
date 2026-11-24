import { describe, expect, it, vi } from 'vitest';

// The log is read from the database, but saying a row in words is not.
vi.mock('./db/index.ts', () => ({ db: {} }));

import { inWords } from './security-log.ts';
import { VIA } from '../../cli/user.ts';

describe('the security log, in words', () => {
	it('says what was done on the host was done from its command line', () => {
		expect(inWords('user_created', { access: 'full', via: VIA })).toBe(
			'with Full access · from the command line on the host'
		);
	});

	it('says so of what scripts/user.mjs wrote before it, which stands as it was written', () => {
		expect(inWords('authn_link_issued', { purpose: 'invite', via: 'scripts/user.mjs' })).toContain(
			'from the command line on the host'
		);
	});

	it('says nothing of where what the server did came from', () => {
		expect(inWords('user_created', { access: 'full' })).not.toContain('command line');
	});
});
