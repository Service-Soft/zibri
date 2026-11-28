import { getZonedDate } from './get-zoned-date.function';
import { DateFormatString, DateFormatToken, dateFormatTokens } from './models/date-format.model';
import { LocaleCode } from './models/locale-code.model';
import { monthLabels } from './models/month.enum';
import { Timezone } from './models/timezone.model';
import { weekdayLabels } from './models/weekday.enum';
import { ZonedDate } from './models/zoned-date.model';

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