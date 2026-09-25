import { DateFormatString, DateFormatToken, dateFormatTokens } from './models/date-format.model';
import { LocaleCode } from './models/locale-code.model';
import { Month, monthLabels } from './models/month.enum';
import { Timezone } from './models/timezone.model';
import { Weekday, weekdayLabels } from './models/weekday.enum';

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

/**
 * Cached per zone, because building an `Intl.DateTimeFormat` costs far more than formatting with one
 * and dates get formatted in loops (invoice lines, table rows, log exports).
 */
const zonedDateFormatters: Map<Timezone, Intl.DateTimeFormat> = new Map();

/**
 * Reads the calendar fields of an instant in the given time zone.
 * A `Date` is a point in time, so which year, day and hour it falls on is a question only a zone answers.
 *
 * The formatter is pinned to the Gregorian calendar and Latin digits rather than following the locale
 * being formatted for, because its output is read back with `Number` instead of shown to anyone: a
 * locale carrying its own numbering system or calendar would turn the year into Arabic-Indic digits or
 * into a Buddhist or Japanese era count. Everything the locale does decide - month and weekday names,
 * padding, 12 or 24 hour clock - is decided by the labels and the format string instead.
 * @param date - The instant to read.
 * @param timezone - The time zone to read it in.
 * @returns The calendar fields of the instant in that zone.
 */
export function getZonedDate(date: Date, timezone: Timezone): ZonedDate {
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
    const month: Month = Number(parts['month']) - 1 as Month;
    const day: number = Number(parts['day']);

    return {
        year: year,
        month: month,
        day: day,
        // the weekday of the zoned calendar date, read back through UTC so that no second zone shifts it again
        weekday: new Date(Date.UTC(year, month, day)).getUTCDay() as Weekday,
        hours: Number(parts['hour']),
        minutes: Number(parts['minute']),
        seconds: Number(parts['second'])
    };
}

/**
 * Formats a date according to a strictly‑typed format string.
 * @param inputDate - The date to format.
 * @param format - The format pattern (must be a string literal that passes validation).
 * @param locale - The locale to use.
 * @param timezone - The time zone to read the date in, deciding which calendar day and hour it lands on.
 * @returns The formatted date string.
 */
export function formatDate<const S extends string>(
    inputDate: Date,
    format: DateFormatString<S>,
    locale: LocaleCode,
    timezone: Timezone
): string {
    const date: ZonedDate = getZonedDate(inputDate, timezone);
    const pad: (n: number) => string = (n: number) => String(n).padStart(2, '0');

    const amPmHours: number = date.hours === 0 ? 12 : date.hours > 12 ? date.hours - 12 : date.hours;
    const amPmLabel: string = date.hours >= 12 ? 'PM' : 'AM';

    const replacements: Record<DateFormatToken, string> = {
        YYYY: String(date.year),
        YY: pad(date.year % 100),

        MMMM: monthLabels[date.month].getValue(locale),
        MM: pad(date.month + 1),
        M: String(date.month + 1),

        DD: pad(date.day),
        D: String(date.day),
        dddd: weekdayLabels[date.weekday].getValue(locale),

        HH: pad(date.hours),
        H: String(date.hours),
        hh: pad(amPmHours),
        h: String(amPmHours),

        mm: pad(date.minutes),
        m: date.minutes.toString(),

        ss: pad(date.seconds),
        s: date.seconds.toString(),

        A: amPmLabel,
        a: amPmLabel.toLowerCase()
    };

    // Replace tokens by scanning the format string
    let result: string = '';
    let i: number = 0;
    while (i < format.length) {
        let matched: boolean = false;
        for (const token of dateFormatTokens) {
            if (format.startsWith(token, i)) {
                result += replacements[token];
                i += token.length;
                matched = true;
                break;
            }
        }
        if (!matched) {
            // it's a separator character
            result += format[i];
            i++;
        }
    }
    return result;
}