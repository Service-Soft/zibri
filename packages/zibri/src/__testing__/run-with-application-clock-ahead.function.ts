import { jest } from '@jest/globals';

import { runApplicationClockAhead } from './run-application-clock-ahead.function';

/**
 * Runs work with the clock of the application ahead, as {@link runApplicationClockAhead} moves it, and
 * sets it right again afterwards.
 * @param aheadInMs - How far ahead, negative for behind.
 * @param work - The work.
 * @returns What the work resolves.
 */
export async function runWithApplicationClockAhead<R>(aheadInMs: number, work: () => Promise<R>): Promise<R> {
    runApplicationClockAhead(aheadInMs);
    try {
        return await work();
    }
    finally {
        jest.useRealTimers();
    }
}