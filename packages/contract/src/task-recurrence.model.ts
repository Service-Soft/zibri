/**
 * The units a recurring task repeats in.
 */
// eslint-disable-next-line typescript/typedef
export const RECURRENCE_UNITS = ['day', 'week', 'month', 'year'] as const;

/**
 * One of {@link RECURRENCE_UNITS}.
 */
export type RecurrenceUnit = typeof RECURRENCE_UNITS[number];

/**
 * When a recurring task is due, counted from its `startsOn`: every `every` days, weeks, months or years, on the days
 * the unit takes, until a day or a number of occurrences. A day is written as `2026-07-31`.
 */
export type TaskRecurrenceModel = {
    /**
     * How many units lie between two periods, at least 1, such as 3 for every quarter with `month`.
     */
    every: number,
    /**
     * The unit of a period.
     */
    unit: RecurrenceUnit,
    /**
     * With `week`: the weekdays of each week it is due on, 0 for Sunday to 6 for Saturday. The weekday of `startsOn`
     * when absent.
     */
    weekdays?: number[] | null,
    /**
     * With `month` and `year`: the day of the month it is due on, 1 to 31, or -1 for the last day. A month without the
     * day, such as the 31st in April or the 29th of February in a year that is no leap year, takes its last day. The
     * day of `startsOn` when absent.
     */
    dayOfMonth?: number | null,
    /**
     * With `year`: the month it is due in, 1 for January to 12. The month of `startsOn` when absent.
     */
    month?: number | null,
    /**
     * The last day an occurrence may fall on, or null for none.
     */
    until?: string | null,
    /**
     * The most occurrences, counted from `startsOn`, or null for no limit.
     */
    count?: number | null
};