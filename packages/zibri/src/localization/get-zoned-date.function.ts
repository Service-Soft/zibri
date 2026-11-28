import { Month } from './models/month.enum';
import { Timezone } from './models/timezone.model';
import { ZonedDate } from './models/zoned-date.model';

/**
 * Cached per zone, because building an `Intl.DateTimeFormat` costs far more than formatting with one
 * and dates get formatted in loops (invoice lines, table rows, log exports).
 */
const zonedDateFormatters: Map<Timezone, Intl.DateTimeFormat> = new Map();

/**
 * Reads the calendar fields of an instant in the given time zone.
 * A `Date` is a point in time, so which year, day and hour it falls on is a question only a zone answers.
 * The fields are those of the Gregorian calendar, whatever the locale.
 * @param date - The instant to read.
 * @param timezone - The time zone to read it in.
 * @returns The calendar fields of the instant in that zone.
 */
export function getZonedDate(date: Date, timezone: Timezone): ZonedDate {
    // The formatter is pinned to the Gregorian calendar and Latin digits rather than following the locale
    // being formatted for, because its output is read back with `Number` instead of shown to anyone: a
    // locale carrying its own numbering system or calendar would turn the year into Arabic-Indic digits or
    // into a Buddhist or Japanese era count. Everything the locale does decide - month and weekday names,
    // padding, 12 or 24 hour clock - is decided by the labels and the format string instead.
    let formatter: Intl.DateTimeFormat | undefined = zonedDateFormatters.get(timezone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
            timeZone: timezone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        zonedDateFormatters.set(timezone, formatter);
    }

    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(date)) {
        parts[part.type] = part.value;
    }

    const year: number = Number(parts['year']);
    const month: Month = Number(parts['month']) - 1;
    const day: number = Number(parts['day']);

    return {
        year: year,
        month: month,
        day: day,
        // the weekday of the zoned calendar date, read back through UTC so that no second zone shifts it again
        weekday: new Date(Date.UTC(year, month, day)).getUTCDay(),
        hours: Number(parts['hour']),
        minutes: Number(parts['minute']),
        seconds: Number(parts['second'])
    };
}