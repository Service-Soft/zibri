import { describe, expect, it } from '@jest/globals';

import { isLaterVersion } from './is-later-version.function';

describe('isLaterVersion', () => {
    it.each([
        ['4.0.1', '4.0.0'],
        ['4.0.0', '4.0.0-rc.9'],
        ['4.0.0-rc.2', '4.0.0-rc.1'],
        ['4.0.0-rc.10', '4.0.0-rc.9'],
        ['4.0.0-beta', '4.0.0-alpha'],
        ['4.0.0-alpha.1', '4.0.0-alpha'],
        ['4.0.0-alpha.beta', '4.0.0-alpha.1']
    ])('orders %s after %s', (later, earlier) => {
        expect(isLaterVersion(later, earlier)).toBe(true);
        expect(isLaterVersion(earlier, later)).toBe(false);
    });

    it('is no later than itself', () => {
        expect(isLaterVersion('4.0.0-rc.1', '4.0.0-rc.1')).toBe(false);
    });
});