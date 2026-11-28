import { describe, expect, it } from '@jest/globals';

import { BookkeepingDayUtilities } from './bookkeeping-day.utilities';

function day(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
}

describe('BookkeepingDayUtilities', () => {
    // what validateDay refuses is in the cases of the books, whose messages need a started application
    it('takes a midnight UTC as a day', () => {
        expect(() => BookkeepingDayUtilities.validateDay(day('2026-03-31'), 'postingDate')).not.toThrow();
    });

    it('ends a first fiscal year at the end of the calendar year, and every other a year after its start', () => {
        expect(BookkeepingDayUtilities.resolveDefaultEnd(day('2025-03-15'), true)).toEqual(day('2025-12-31'));
        expect(BookkeepingDayUtilities.resolveDefaultEnd(day('2026-01-01'), false)).toEqual(day('2026-12-31'));
        expect(BookkeepingDayUtilities.resolveDefaultEnd(day('2026-07-01'), false)).toEqual(day('2027-06-30'));
        expect(BookkeepingDayUtilities.resolveDefaultEnd(day('2024-02-29'), false)).toEqual(day('2025-02-28'));
        expect(BookkeepingDayUtilities.resolveDefaultEnd(day('2023-03-01'), false)).toEqual(day('2024-02-29'));
    });

    it('steps a day at a time, across the end of a year and a leap day', () => {
        expect(BookkeepingDayUtilities.resolveNextDay(day('2026-12-31'))).toEqual(day('2027-01-01'));
        expect(BookkeepingDayUtilities.resolvePreviousDay(day('2024-03-01'))).toEqual(day('2024-02-29'));
        expect(BookkeepingDayUtilities.formatDay(day('2026-01-05'))).toBe('2026-01-05');
    });
});