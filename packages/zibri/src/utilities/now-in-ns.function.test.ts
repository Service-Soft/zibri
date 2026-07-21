import { describe, expect, it } from '@jest/globals';

import { nowInNs } from './now-in-ns.function';

describe('nowInNs', () => {
    it('returns a bigint', () => {
        expect(typeof nowInNs()).toBe('bigint');
    });

    it('is closely aligned with Date.now() in milliseconds', () => {
        const before: number = Date.now();
        const nowNs: bigint = nowInNs();
        const after: number = Date.now();

        const nowMs: number = Number(nowNs / 1_000_000n);
        expect(nowMs).toBeGreaterThanOrEqual(before - 1);
        expect(nowMs).toBeLessThanOrEqual(after + 1);
    });

    it('increases monotonically across consecutive calls', () => {
        const first: bigint = nowInNs();
        const second: bigint = nowInNs();
        expect(second).toBeGreaterThanOrEqual(first);
    });
});