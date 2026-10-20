import { describe, expect, it, vi, MockInstance } from 'vitest';

import { getTimestamp, warn } from './logger.helpers.ts';

describe('getTimestamp', () => {
    it('formats the current time as HH:MM:SS.mmm, wrapped in ansi codes', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2024, 0, 1, 5, 6, 7, 8));

        const timestamp: string = getTimestamp();

        expect(timestamp).toContain('05:06:07.008');
        vi.useRealTimers();
    });
});

describe('warn', () => {
    it('logs the message to console.warn', () => {
        const spy: MockInstance<typeof console.warn> = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        warn('a warning message');

        expect(spy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'a warning message');
        spy.mockRestore();
    });
});