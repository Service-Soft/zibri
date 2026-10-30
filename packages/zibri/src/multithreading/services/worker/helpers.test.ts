import { describe, expect, it } from '@jest/globals';

import { resolveThreadJobProgress } from './helpers';

describe('resolveThreadJobProgress', () => {
    it('answers the share done in whole percent, rounded down', () => {
        expect(resolveThreadJobProgress(0, 3)).toBe(0);
        expect(resolveThreadJobProgress(1, 3)).toBe(33);
        expect(resolveThreadJobProgress(2, 3)).toBe(66);
        // short of the whole, so a progress report does not complete the job early
        expect(resolveThreadJobProgress(999, 1000)).toBe(99);
        expect(resolveThreadJobProgress(3, 3)).toBe(100);
    });

    it('stays within 0 and 100', () => {
        expect(resolveThreadJobProgress(-1, 3)).toBe(0);
        expect(resolveThreadJobProgress(4, 3)).toBe(100);
        expect(resolveThreadJobProgress(0, 0)).toBe(100);
        expect(resolveThreadJobProgress(Number.NaN, 3)).toBe(0);
    });
});