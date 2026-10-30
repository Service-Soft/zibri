import { jest } from '@jest/globals';

/**
 * Runs the clock of the application ahead, the way the clock of one instance runs ahead of the clock
 * of the data source: `Date` alone, so timers and `performance.now` keep real time, and the time goes
 * on passing. `jest.useRealTimers()` sets it right again.
 * @param aheadInMs - How far ahead, negative for behind.
 */
export function runApplicationClockAhead(aheadInMs: number): void {
    jest.useFakeTimers({
        now: Date.now() + aheadInMs,
        advanceTimers: true,
        doNotFake: [
            'nextTick',
            'setImmediate',
            'clearImmediate',
            'setInterval',
            'clearInterval',
            'setTimeout',
            'clearTimeout',
            'queueMicrotask',
            'hrtime',
            'performance'
        ]
    });
}