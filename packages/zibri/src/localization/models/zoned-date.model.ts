import { Month } from './month.enum';
import { Weekday } from './weekday.enum';

/**
 * The calendar fields that an instant falls on inside one specific time zone.
 */
export type ZonedDate = {
    /**
     * The full year, eg. 2026.
     */
    year: number,
    /**
     * The month, starting at 0 for January.
     */
    month: Month,
    /**
     * The day of the month, starting at 1.
     */
    day: number,
    /**
     * The day of the week, starting at 0 for Sunday.
     */
    weekday: Weekday,
    /**
     * The hours in 24 hour form, 0 to 23.
     */
    hours: number,
    /**
     * The minutes, 0 to 59.
     */
    minutes: number,
    /**
     * The seconds, 0 to 59.
     */
    seconds: number
};