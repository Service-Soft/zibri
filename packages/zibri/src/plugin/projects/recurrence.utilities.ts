import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { getZonedDate, type ZonedDate } from '../../localization/format-date.function';
import { type Timezone } from '../../localization/models/timezone.model';
import { $ts } from '../../localization/translate.function';
import { Ms } from '../../utilities/ms';
import { type NonWorkingDayRule } from './models/non-working-day-rule.model';
import { type TaskRecurrence } from './models/task-recurrence.model';

/**
 * The days of the projects plugin: the days the recurrences of recurring tasks fall on, and the days tasks are due on. A
 * day is a `Date` at its midnight UTC, such as `2026-07-31`, so that it is the same day in every time zone.
 */
export abstract class RecurrenceUtilities {
    /**
     * Resolves the days a recurrence falls on, from its start to a day.
     * @param recurrence - The recurrence.
     * @param startsOn - The first day it may fall on, which its periods are counted from.
     * @param until - The last day to resolve, or the `until` of the recurrence when that is earlier.
     * @returns The days, in their order, at most `count` of the recurrence.
     */
    static resolveOccurrences(recurrence: TaskRecurrence, startsOn: Date, until: Date): Date[] {
        const end: number = Math.min(until.getTime(), recurrence.until?.getTime() ?? Number.POSITIVE_INFINITY);
        const limit: number = recurrence.count ?? Number.POSITIVE_INFINITY;
        const res: Date[] = [];
        // each period of the unit in turn, from the one of the start: a period starting after the end ends the walk
        for (let period: number = 0; res.length < limit; period++) {
            const days: Date[] | undefined = this.resolvePeriodDays(recurrence, startsOn, period * recurrence.every, end);
            if (days == undefined) {
                break;
            }
            for (const day of days) {
                if (day.getTime() >= startsOn.getTime() && day.getTime() <= end && res.length < limit) {
                    res.push(day);
                }
            }
        }
        return res;
    }

    /**
     * Resolves the day a due date on a day that is not a working day goes to.
     * @param day - The day it falls on.
     * @param rule - Whether it is kept, or moved to the previous or the next working day.
     * @param isWorkingDay - Whether a day is a working day.
     * @returns The day, the same when it is a working day, kept, or no working day is found within a year.
     */
    static resolveWorkingDay(day: Date, rule: NonWorkingDayRule, isWorkingDay: (day: Date) => boolean): Date {
        if (rule === 'keep' || isWorkingDay(day)) {
            return day;
        }
        const step: number = rule === 'previous' ? -Ms.DAY : Ms.DAY;
        // a calendar takes at least one working weekday, so a year of holidays is the most there is to step over
        for (let i: number = 1; i <= 366; i++) {
            const candidate: Date = new Date(day.getTime() + i * step);
            if (isWorkingDay(candidate)) {
                return candidate;
            }
        }
        return day;
    }

    /**
     * Resolves the day a moment falls on in a time zone.
     * @param moment - The moment.
     * @param timezone - The time zone, such as `Europe/Berlin`.
     * @returns The day, at its midnight UTC.
     */
    static resolveDay(moment: Date, timezone: Timezone): Date {
        const zoned: ZonedDate = getZonedDate(moment, timezone);
        return new Date(Date.UTC(zoned.year, zoned.month, zoned.day));
    }

    /**
     * Validates a recurrence and its start.
     * @param recurrence - The recurrence.
     * @param startsOn - The first day it may fall on.
     * @throws A BadRequestError naming what does not fit.
     */
    static validateRecurrence(recurrence: TaskRecurrence, startsOn: Date): void {
        this.validateDay(startsOn, 'startsOn');
        if (recurrence.until != undefined) {
            this.validateDay(recurrence.until, 'until');
            if (recurrence.until.getTime() < startsOn.getTime()) {
                throw new BadRequestError($ts`The until of a recurrence needs to be on or after its startsOn.`);
            }
        }
        if (recurrence.weekdays != undefined && (recurrence.unit !== 'week' || !recurrence.weekdays.length)) {
            throw new BadRequestError($ts`The weekdays of a recurrence need to be at least one, and go with the unit week.`);
        }
        if (recurrence.dayOfMonth != undefined && (recurrence.unit === 'day' || recurrence.unit === 'week' || recurrence.dayOfMonth === 0)) {
            throw new BadRequestError($ts`The dayOfMonth of a recurrence needs to be 1 to 31 or -1, and goes with the unit month or year.`);
        }
        if (recurrence.month != undefined && recurrence.unit !== 'year') {
            throw new BadRequestError($ts`The month of a recurrence goes with the unit year.`);
        }
    }

    /**
     * Validates that a date is a day: its midnight UTC.
     * @param day - The date.
     * @param name - The name of the property it is.
     * @throws A BadRequestError for a date with a time.
     */
    static validateDay(day: Date, name: string): void {
        if (Number.isNaN(day.getTime()) || day.getTime() % Ms.DAY !== 0) {
            throw new BadRequestError($ts`The ${name} needs to be a day without a time, such as 2026-03-31.`);
        }
    }

    /**
     * Resolves the days of one period of a recurrence.
     * @param recurrence - The recurrence.
     * @param startsOn - Its start.
     * @param offset - How many units the period is after the one of the start.
     * @param end - The last moment to resolve.
     * @returns The days of the period, or undefined when it starts after the end.
     */
    private static resolvePeriodDays(recurrence: TaskRecurrence, startsOn: Date, offset: number, end: number): Date[] | undefined {
        const year: number = startsOn.getUTCFullYear();
        const month: number = startsOn.getUTCMonth();
        switch (recurrence.unit) {
            case 'day': {
                const day: Date = new Date(startsOn.getTime() + offset * Ms.DAY);
                return day.getTime() > end ? undefined : [day];
            }
            case 'week': {
                // weeks start on a Monday, as RFC 5545 counts them by default
                const weekStart: number = startsOn.getTime() - this.resolveDaysSinceMonday(startsOn.getUTCDay()) * Ms.DAY + offset * 7 * Ms.DAY;
                if (weekStart > end) {
                    return undefined;
                }
                const weekdays: number[] = [...new Set(recurrence.weekdays ?? [startsOn.getUTCDay()])];
                return weekdays
                    .map(weekday => this.resolveDaysSinceMonday(weekday))
                    .sort((a, b) => a - b)
                    .map(days => new Date(weekStart + days * Ms.DAY));
            }
            case 'month': {
                if (Date.UTC(year, month + offset, 1) > end) {
                    return undefined;
                }
                return [this.resolveDayOfMonth(year, month + offset, recurrence.dayOfMonth ?? startsOn.getUTCDate())];
            }
            case 'year': {
                if (Date.UTC(year + offset, 0, 1) > end) {
                    return undefined;
                }
                const due: number = recurrence.month == undefined ? month : recurrence.month - 1;
                return [this.resolveDayOfMonth(year + offset, due, recurrence.dayOfMonth ?? startsOn.getUTCDate())];
            }
        }
    }

    /**
     * Resolves a day of a month, its last day for a day it does not have.
     * @param year - The year.
     * @param month - The month, 0 for January, or beyond 11 for the months of the years after.
     * @param dayOfMonth - The day, 1 to 31, or -1 for the last day.
     * @returns The day.
     */
    private static resolveDayOfMonth(year: number, month: number, dayOfMonth: number): Date {
        const last: number = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        return new Date(Date.UTC(year, month, dayOfMonth === -1 ? last : Math.min(dayOfMonth, last)));
    }

    /**
     * Resolves how many days a weekday is after the Monday of its week.
     * @param weekday - The weekday, 0 for Sunday.
     * @returns The days, 0 for Monday to 6 for Sunday.
     */
    private static resolveDaysSinceMonday(weekday: number): number {
        return (weekday + 6) % 7;
    }
}
