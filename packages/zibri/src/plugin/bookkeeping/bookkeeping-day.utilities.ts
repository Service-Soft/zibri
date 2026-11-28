import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { getZonedDate, ZonedDate } from '../../localization/format-date.function';
import { type Timezone } from '../../localization/models/timezone.model';
import { $ts } from '../../localization/translate.function';
import { Ms } from '../../utilities/ms';

/**
 * The days the books are kept by: a posting date, a document date and the first and last day of a fiscal year are
 * calendar days, each held as its midnight UTC, so that a day is the same in every time zone.
 */
export abstract class BookkeepingDayUtilities {
    /**
     * Resolves the day a moment falls on in a time zone, such as the day of an invoice issued at 23:30 in Berlin.
     * @param date - The moment.
     * @param timezone - The time zone, such as `Europe/Berlin`.
     * @returns The day, at midnight UTC.
     */
    static resolveDay(date: Date, timezone: Timezone): Date {
        const zoned: ZonedDate = getZonedDate(date, timezone);
        return new Date(Date.UTC(zoned.year, zoned.month, zoned.day));
    }

    /**
     * Validates that a date is a day: its midnight UTC, as `2026-03-31` is read.
     * @param day - The date.
     * @param name - The name of the property it is, such as `postingDate`.
     * @throws A BadRequestError for a date with a time.
     */
    static validateDay(day: Date, name: string): void {
        if (Number.isNaN(day.getTime()) || day.getTime() % Ms.DAY !== 0) {
            throw new BadRequestError($ts`The ${name} needs to be a day without a time, such as 2026-03-31.`);
        }
    }

    /**
     * Formats a day the way it is written, such as `2026-03-31`.
     * @param day - The day.
     * @returns The day.
     */
    static formatDay(day: Date): string {
        return day.toISOString().slice(0, 10);
    }

    /**
     * Resolves the day after a day.
     * @param day - The day.
     * @returns The day after it.
     */
    static resolveNextDay(day: Date): Date {
        return new Date(day.getTime() + Ms.DAY);
    }

    /**
     * Resolves the day before a day.
     * @param day - The day.
     * @returns The day before it.
     */
    static resolvePreviousDay(day: Date): Date {
        return new Date(day.getTime() - Ms.DAY);
    }

    /**
     * Resolves the last day of a fiscal year starting on a day, when it names none: the day before the same day a year
     * later, which keeps the rhythm of the years before it, or the end of the calendar year of the start for the first
     * fiscal year of the books, which is often a short one after the founding.
     * @param start - The first day of the fiscal year.
     * @param first - Whether it is the first fiscal year of the books.
     * @returns The last day.
     */
    static resolveDefaultEnd(start: Date, first: boolean): Date {
        if (first) {
            return new Date(Date.UTC(start.getUTCFullYear(), 11, 31));
        }
        // Date.UTC runs the day over, so the 29th of February a year later is the 1st of March, the day after it
        return this.resolvePreviousDay(new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate())));
    }
}
