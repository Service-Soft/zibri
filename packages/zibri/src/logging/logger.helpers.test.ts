import { describe, expect, it, jest } from '@jest/globals';

import { getTimestamp, warn } from './logger.helpers';

describe('getTimestamp', () => {
    it('formats the current time as HH:MM:SS.mmm, wrapped in ansi codes', () => {
        const fixedDate: Date = new Date(2024, 0, 1, 5, 6, 7, 8);
        const spy: jest.SpiedClass<typeof Date> = jest.spyOn(global, 'Date').mockImplementation(() => fixedDate);

        const timestamp: string = getTimestamp();

        expect(timestamp).toContain('05:06:07.008');
        spy.mockRestore();
    });
});

describe('warn', () => {
    it('logs the message to console.warn', () => {
        const spy: jest.SpiedFunction<typeof console.warn> = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        warn('a warning message');

        expect(spy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'a warning message');
        spy.mockRestore();
    });
});