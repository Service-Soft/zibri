import { $t, TranslationToken } from '../translate.function';

/**
 * Definition of the days in the week as defined by the js Date object.
 */
export enum Weekday {
    MONDAY = 1,
    TUESDAY = 2,
    WEDNESDAY = 3,
    THURSDAY = 4,
    FRIDAY = 5,
    SATURDAY = 6,
    SUNDAY = 0
}

/**
 * Labels for the given weekdays.
 */
export const weekdayLabels: Record<Weekday, TranslationToken> = {
    [Weekday.MONDAY]: $t`Monday`,
    [Weekday.TUESDAY]: $t`Tuesday`,
    [Weekday.WEDNESDAY]: $t`Wednesday`,
    [Weekday.THURSDAY]: $t`Thursday`,
    [Weekday.FRIDAY]: $t`Friday`,
    [Weekday.SATURDAY]: $t`Saturday`,
    [Weekday.SUNDAY]: $t`Sunday`
};