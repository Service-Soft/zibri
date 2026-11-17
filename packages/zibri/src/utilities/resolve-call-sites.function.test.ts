import { describe, expect, it } from '@jest/globals';

import { resolveCallSites } from './resolve-call-sites.function';

/**
 * Collects the frames from a few calls down.
 * @param depth - How many calls down.
 * @param maxFrames - The most frames to collect.
 * @returns The frames.
 */
function collectFromDepth(depth: number, maxFrames: number): NodeJS.CallSite[] {
    return depth > 0 ? collectFromDepth(depth - 1, maxFrames) : resolveCallSites(collectFromDepth, maxFrames);
}

describe('resolveCallSites', () => {
    it('collects no more frames than it is asked for, and leaves the limit of the process as it was', () => {
        const limit: number = Error.stackTraceLimit;

        expect(collectFromDepth(20, 3)).toHaveLength(3);
        expect(Error.stackTraceLimit).toBe(limit);
    });

    it('collects no more frames than the process keeps', () => {
        const limit: number = Error.stackTraceLimit;
        Error.stackTraceLimit = 2;
        try {
            expect(collectFromDepth(20, 3)).toHaveLength(2);
        }
        finally {
            Error.stackTraceLimit = limit;
        }
    });
});