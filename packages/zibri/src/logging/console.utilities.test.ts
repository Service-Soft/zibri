import { describe, expect, it, jest } from '@jest/globals';

import { ConsoleUtilities } from './console.utilities';

describe('ConsoleUtilities.warn', () => {
    it('logs the message to console.warn', () => {
        const spy: jest.SpiedFunction<typeof console.warn> = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        ConsoleUtilities.warn('a warning message');

        expect(spy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'a warning message');
        spy.mockRestore();
    });

    it('prefixes the current time as HH:MM:SS.mmm, wrapped in ansi codes', () => {
        const fixedDate: Date = new Date(2024, 0, 1, 5, 6, 7, 8);
        const dateSpy: jest.SpiedClass<typeof Date> = jest.spyOn(global, 'Date').mockImplementation(() => fixedDate);
        const warnSpy: jest.SpiedFunction<typeof console.warn> = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        ConsoleUtilities.warn('a warning message');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('05:06:07.008'), expect.any(String), 'a warning message');
        warnSpy.mockRestore();
        dateSpy.mockRestore();
    });
});