import { describe, expect, it } from '@jest/globals';

import { formatDate } from './format-date.function';

describe('formatDate', () => {
    describe('AM/PM boundary handling', () => {
        it('formats midnight (00:xx) as 12 AM, not 0 AM', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 0, 30, 0));
            expect(formatDate(date, 'hh:mm A', 'en', 'UTC')).toBe('12:30 AM');
        });

        it('formats noon (12:xx) as 12 PM, not 12 AM', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 12, 15, 0));
            expect(formatDate(date, 'hh:mm A', 'en', 'UTC')).toBe('12:15 PM');
        });

        it('formats 1 PM correctly (13:00 -> 1 PM)', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 13, 0, 0));
            expect(formatDate(date, 'hh:mm A', 'en', 'UTC')).toBe('01:00 PM');
        });

        it('formats 11 PM correctly (23:00 -> 11 PM)', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 23, 0, 0));
            expect(formatDate(date, 'hh:mm A', 'en', 'UTC')).toBe('11:00 PM');
        });

        it('formats 11 AM correctly (11:00 -> 11 AM)', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 11, 0, 0));
            expect(formatDate(date, 'hh:mm A', 'en', 'UTC')).toBe('11:00 AM');
        });

        it('formats 1 AM correctly (01:00 -> 1 AM)', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 1, 0, 0));
            expect(formatDate(date, 'hh:mm A', 'en', 'UTC')).toBe('01:00 AM');
        });

        it('lowercase "a" token matches the lowercase am/pm label', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 12, 0, 0));
            expect(formatDate(date, 'hh:mm a', 'en', 'UTC')).toBe('12:00 pm');
        });

        it('the unpadded "h" token does not zero-pad single digit hours', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 1, 0, 0));
            expect(formatDate(date, 'h:mm A', 'en', 'UTC')).toBe('1:00 AM');
        });
    });

    describe('24-hour tokens are unaffected by AM/PM conversion', () => {
        it('HH keeps 0 for midnight', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
            expect(formatDate(date, 'HH:mm', 'en', 'UTC')).toBe('00:00');
        });

        it('HH keeps 23 for 11pm', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 23, 0, 0));
            expect(formatDate(date, 'HH:mm', 'en', 'UTC')).toBe('23:00');
        });
    });

    describe('date tokens', () => {
        it('formats a full date with year/month/day', () => {
            const date: Date = new Date(Date.UTC(2024, 5, 9));
            expect(formatDate(date, 'YYYY-MM-DD', 'en', 'UTC')).toBe('2024-06-09');
        });

        it('formats a 2-digit year', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1));
            expect(formatDate(date, 'YY', 'en', 'UTC')).toBe('24');
        });

        it('formats unpadded month and day', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 9));
            expect(formatDate(date, 'M/D', 'en', 'UTC')).toBe('1/9');
        });

        it('formats seconds with and without padding', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 0, 0, 5));
            expect(formatDate(date, 'ss', 'en', 'UTC')).toBe('05');
            expect(formatDate(date, 's', 'en', 'UTC')).toBe('5');
        });

        it('passes separator characters through untouched', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 9));
            expect(formatDate(date, 'DD.MM.YYYY', 'en', 'UTC')).toBe('09.01.2024');
        });

        it('formats the month and weekday names', () => {
            // a Sunday
            const date: Date = new Date(Date.UTC(2024, 5, 9, 12));
            expect(formatDate(date, 'dddd, MMMM D', 'en', 'UTC')).toBe('Sunday, June 9');
        });
    });

    describe('time zones', () => {
        it('puts the same instant on a different clock per zone', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 15, 12, 0, 0));
            expect(formatDate(date, 'HH:mm', 'en', 'UTC')).toBe('12:00');
            expect(formatDate(date, 'HH:mm', 'en', 'Europe/Berlin')).toBe('13:00');
            expect(formatDate(date, 'HH:mm', 'en', 'America/New_York')).toBe('07:00');
            expect(formatDate(date, 'HH:mm', 'en', 'Asia/Tokyo')).toBe('21:00');
        });

        it('rolls the calendar day back for a zone behind the instant', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 1, 2, 30, 0));
            expect(formatDate(date, 'YYYY-MM-DD HH:mm', 'en', 'UTC')).toBe('2024-01-01 02:30');
            expect(formatDate(date, 'YYYY-MM-DD HH:mm', 'en', 'America/New_York')).toBe('2023-12-31 21:30');
        });

        it('rolls the calendar day forward for a zone ahead of the instant', () => {
            const date: Date = new Date(Date.UTC(2024, 11, 31, 23, 30, 0));
            expect(formatDate(date, 'YYYY-MM-DD HH:mm', 'en', 'UTC')).toBe('2024-12-31 23:30');
            expect(formatDate(date, 'YYYY-MM-DD HH:mm', 'en', 'Asia/Tokyo')).toBe('2025-01-01 08:30');
        });

        it('follows daylight saving inside one zone', () => {
            const winter: Date = new Date(Date.UTC(2024, 0, 15, 12, 0, 0));
            const summer: Date = new Date(Date.UTC(2024, 6, 15, 12, 0, 0));
            // Berlin is UTC+1 in January and UTC+2 in July
            expect(formatDate(winter, 'HH:mm', 'en', 'Europe/Berlin')).toBe('13:00');
            expect(formatDate(summer, 'HH:mm', 'en', 'Europe/Berlin')).toBe('14:00');
        });

        it('reads the weekday and month name of the zoned day', () => {
            // Sunday 23:00 utc is already Monday in Tokyo
            const date: Date = new Date(Date.UTC(2024, 5, 9, 23, 0, 0));
            expect(formatDate(date, 'dddd', 'en', 'UTC')).toBe('Sunday');
            expect(formatDate(date, 'dddd', 'en', 'Asia/Tokyo')).toBe('Monday');

            // the first instant of February in utc is still January 31st in New York
            const monthBoundary: Date = new Date(Date.UTC(2024, 1, 1, 0, 30, 0));
            expect(formatDate(monthBoundary, 'MMMM D', 'en', 'UTC')).toBe('February 1');
            expect(formatDate(monthBoundary, 'MMMM D', 'en', 'America/New_York')).toBe('January 31');
        });

        it('formats a zone with a half hour offset', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 15, 12, 0, 0));
            expect(formatDate(date, 'HH:mm', 'en', 'Asia/Calcutta')).toBe('17:30');
        });

        it('keeps midnight at 00 rather than 24', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 15, 23, 0, 0));
            expect(formatDate(date, 'HH:mm', 'en', 'Europe/Berlin')).toBe('00:00');
            expect(formatDate(date, 'hh:mm A', 'en', 'Europe/Berlin')).toBe('12:00 AM');
        });

        it('formats the same instant identically for repeated calls, so the cached formatter stays correct', () => {
            const date: Date = new Date(Date.UTC(2024, 0, 15, 12, 0, 0));
            expect(formatDate(date, 'HH:mm', 'en', 'Europe/Berlin')).toBe('13:00');
            expect(formatDate(date, 'HH:mm', 'en', 'Asia/Tokyo')).toBe('21:00');
            expect(formatDate(date, 'HH:mm', 'en', 'Europe/Berlin')).toBe('13:00');
        });
    });
});