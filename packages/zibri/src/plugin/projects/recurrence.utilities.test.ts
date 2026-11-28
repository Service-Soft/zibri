import { describe, expect, it } from '@jest/globals';

import { type TaskRecurrence } from './models/task-recurrence.model';
import { RecurrenceUtilities } from './recurrence.utilities';

function day(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
}

function days(recurrence: TaskRecurrence, startsOn: string, until: string): string[] {
    return RecurrenceUtilities.resolveOccurrences(recurrence, day(startsOn), day(until)).map(d => d.toISOString().slice(0, 10));
}

describe('RecurrenceUtilities', () => {
    describe('the days of a recurrence', () => {
        it('falls on every n days', () => {
            expect(days({ every: 3, unit: 'day' }, '2027-02-26', '2027-03-08')).toEqual(['2027-02-26', '2027-03-01', '2027-03-04', '2027-03-07']);
        });

        it('falls on the weekdays of every n weeks, the weekday of its start without any', () => {
            // 2027-03-03 is a Wednesday
            expect(days({ every: 1, unit: 'week' }, '2027-03-03', '2027-03-20')).toEqual(['2027-03-03', '2027-03-10', '2027-03-17']);
            expect(days({ every: 2, unit: 'week', weekdays: [5, 1] }, '2027-03-03', '2027-03-31'))
                .toEqual(['2027-03-05', '2027-03-15', '2027-03-19', '2027-03-29']);
            // a Sunday ends the week that started on the Monday before it
            expect(days({ every: 1, unit: 'week', weekdays: [0] }, '2027-03-01', '2027-03-15')).toEqual(['2027-03-07', '2027-03-14']);
        });

        it('falls on a day of every n months, the last day of a month without it', () => {
            expect(days({ every: 1, unit: 'month', dayOfMonth: 31 }, '2027-01-31', '2027-05-31'))
                .toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
            expect(days({ every: 3, unit: 'month', dayOfMonth: 10 }, '2027-01-15', '2027-12-31')).toEqual(['2027-04-10', '2027-07-10', '2027-10-10']);
            expect(days({ every: 1, unit: 'month', dayOfMonth: -1 }, '2028-01-01', '2028-03-31')).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
            // the day of its start without a day of its own
            expect(days({ every: 1, unit: 'month' }, '2027-01-30', '2027-03-31')).toEqual(['2027-01-30', '2027-02-28', '2027-03-30']);
        });

        it('falls on a day of a month of every n years, the 28th of February in a year that is no leap year', () => {
            expect(days({ every: 1, unit: 'year', month: 7, dayOfMonth: 31 }, '2027-01-01', '2029-12-31')).toEqual(['2027-07-31', '2028-07-31', '2029-07-31']);
            expect(days({ every: 1, unit: 'year' }, '2028-02-29', '2033-01-01')).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
            expect(days({ every: 2, unit: 'year', month: 3 }, '2027-05-10', '2033-01-01')).toEqual(['2029-03-10', '2031-03-10']);
        });

        it('ends at its until and after its count, counted from its start', () => {
            expect(days({ every: 1, unit: 'day', until: day('2027-03-03') }, '2027-03-01', '2027-03-31')).toEqual(['2027-03-01', '2027-03-02', '2027-03-03']);
            expect(days({ every: 1, unit: 'week', weekdays: [1, 3], count: 3 }, '2027-03-03', '2027-12-31')).toEqual(['2027-03-03', '2027-03-08', '2027-03-10']);
            expect(days({ every: 1, unit: 'month', count: 2 }, '2027-01-15', '2027-01-31')).toEqual(['2027-01-15']);
        });
    });

    describe('a due date on a day that is not a working day', () => {
        // Monday to Friday, without Friday the 5th of March 2027
        const isWorkingDay: (d: Date) => boolean = d => d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && d.getTime() !== day('2027-03-05').getTime();

        it('is kept, or moved to the previous or the next working day, over weekends and holidays', () => {
            // Saturday the 6th
            expect(RecurrenceUtilities.resolveWorkingDay(day('2027-03-06'), 'keep', isWorkingDay)).toEqual(day('2027-03-06'));
            expect(RecurrenceUtilities.resolveWorkingDay(day('2027-03-06'), 'previous', isWorkingDay)).toEqual(day('2027-03-04'));
            expect(RecurrenceUtilities.resolveWorkingDay(day('2027-03-06'), 'next', isWorkingDay)).toEqual(day('2027-03-08'));
            expect(RecurrenceUtilities.resolveWorkingDay(day('2027-03-03'), 'next', isWorkingDay)).toEqual(day('2027-03-03'));
        });
    });

    describe('the day of a moment', () => {
        it('is the day it is in the time zone', () => {
            expect(RecurrenceUtilities.resolveDay(new Date('2027-07-14T23:30:00.000Z'), 'Europe/Berlin')).toEqual(day('2027-07-15'));
            expect(RecurrenceUtilities.resolveDay(new Date('2027-07-15T03:30:00.000Z'), 'America/New_York')).toEqual(day('2027-07-14'));
        });
    });
});