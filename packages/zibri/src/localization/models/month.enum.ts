import { $t, TranslationToken } from '../translate.function';

/**
 * Definition of the months in a year as defined by the js Date object.
 */
export enum Month {
    JANUARY = 0,
    FEBRUARY = 1,
    MARCH = 2,
    APRIL = 3,
    MAY = 4,
    JUNE = 5,
    JULY = 6,
    AUGUST = 7,
    SEPTEMBER = 8,
    OCTOBER = 9,
    NOVEMBER = 10,
    DECEMBER = 11
}

/**
 * Labels for the months in a year.
 */
export const monthLabels: Record<Month, TranslationToken> = {
    [Month.JANUARY]: $t`January`,
    [Month.FEBRUARY]: $t`February`,
    [Month.MARCH]: $t`March`,
    [Month.APRIL]: $t`April`,
    [Month.MAY]: $t`May`,
    [Month.JUNE]: $t`June`,
    [Month.JULY]: $t`July`,
    [Month.AUGUST]: $t`August`,
    [Month.SEPTEMBER]: $t`September`,
    [Month.OCTOBER]: $t`October`,
    [Month.NOVEMBER]: $t`November`,
    [Month.DECEMBER]: $t`December`
};