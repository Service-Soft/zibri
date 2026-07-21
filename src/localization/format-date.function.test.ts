import { describe, expect, it } from '@jest/globals';

import { formatDate } from './format-date.function';

describe('formatDate', () => {
    describe('AM/PM boundary handling', () => {
        it('formats midnight (00:xx) as 12 AM, not 0 AM', () => {
            const date: Date = new Date(2024, 0, 1, 0, 30, 0);
            expect(formatDate(date, 'hh:mm A', 'en')).toBe('12:30 AM');
        });

        it('formats noon (12:xx) as 12 PM, not 12 AM', () => {
            const date: Date = new Date(2024, 0, 1, 12, 15, 0);
            expect(formatDate(date, 'hh:mm A', 'en')).toBe('12:15 PM');
        });

        it('formats 1 PM correctly (13:00 -> 1 PM)', () => {
            const date: Date = new Date(2024, 0, 1, 13, 0, 0);
            expect(formatDate(date, 'hh:mm A', 'en')).toBe('01:00 PM');
        });

        it('formats 11 PM correctly (23:00 -> 11 PM)', () => {
            const date: Date = new Date(2024, 0, 1, 23, 0, 0);
            expect(formatDate(date, 'hh:mm A', 'en')).toBe('11:00 PM');
        });

        it('formats 11 AM correctly (11:00 -> 11 AM)', () => {
            const date: Date = new Date(2024, 0, 1, 11, 0, 0);
            expect(formatDate(date, 'hh:mm A', 'en')).toBe('11:00 AM');
        });

        it('formats 1 AM correctly (01:00 -> 1 AM)', () => {
            const date: Date = new Date(2024, 0, 1, 1, 0, 0);
            expect(formatDate(date, 'hh:mm A', 'en')).toBe('01:00 AM');
        });

        it('lowercase "a" token matches the lowercase am/pm label', () => {
            const date: Date = new Date(2024, 0, 1, 12, 0, 0);
            expect(formatDate(date, 'hh:mm a', 'en')).toBe('12:00 pm');
        });

        it('the unpadded "h" token does not zero-pad single digit hours', () => {
            const date: Date = new Date(2024, 0, 1, 1, 0, 0);
            expect(formatDate(date, 'h:mm A', 'en')).toBe('1:00 AM');
        });
    });

    describe('24-hour tokens are unaffected by AM/PM conversion', () => {
        it('HH keeps 0 for midnight', () => {
            const date: Date = new Date(2024, 0, 1, 0, 0, 0);
            expect(formatDate(date, 'HH:mm', 'en')).toBe('00:00');
        });

        it('HH keeps 23 for 11pm', () => {
            const date: Date = new Date(2024, 0, 1, 23, 0, 0);
            expect(formatDate(date, 'HH:mm', 'en')).toBe('23:00');
        });
    });

    describe('date tokens', () => {
        it('formats a full date with year/month/day', () => {
            const date: Date = new Date(2024, 5, 9);
            expect(formatDate(date, 'YYYY-MM-DD', 'en')).toBe('2024-06-09');
        });

        it('formats a 2-digit year', () => {
            const date: Date = new Date(2024, 0, 1);
            expect(formatDate(date, 'YY', 'en')).toBe('24');
        });

        it('formats unpadded month and day', () => {
            const date: Date = new Date(2024, 0, 9);
            expect(formatDate(date, 'M/D', 'en')).toBe('1/9');
        });

        it('formats seconds with and without padding', () => {
            const date: Date = new Date(2024, 0, 1, 0, 0, 5);
            expect(formatDate(date, 'ss', 'en')).toBe('05');
            expect(formatDate(date, 's', 'en')).toBe('5');
        });

        it('passes separator characters through untouched', () => {
            const date: Date = new Date(2024, 0, 9);
            expect(formatDate(date, 'DD.MM.YYYY', 'en')).toBe('09.01.2024');
        });
    });
});