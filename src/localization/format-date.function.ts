import { DateFormatString, DateFormatToken, dateFormatTokens } from './models/date-format.model';
import { LocaleCode } from './models/locale-code.model';
import { Month, monthLabels } from './models/month.enum';
import { Weekday, weekdayLabels } from './models/weekday.enum';
/**
 * Formats a date according to a strictly‑typed format string.
 * @param inputDate - The date to format.
 * @param format - The format pattern (must be a string literal that passes validation).
 * @param locale - The locale to use.
 * @returns The formatted date string.
 */
export function formatDate<const S extends string>(
    inputDate: Date,
    format: DateFormatString<S>,
    locale: LocaleCode
): string {
    const date: Date = new Date(inputDate);
    const pad: (n: number) => string = (n: number) => String(n).padStart(2, '0');

    const month: Month = date.getMonth() as Month;
    const hours: number = date.getHours();
    const amPmHours: number = hours >= 13 ? hours - 12 : hours;
    const amPmLabel: string = hours >= 13 ? 'PM' : 'AM';

    const replacements: Record<DateFormatToken, string> = {
        YYYY: String(date.getFullYear()),
        YY: pad(date.getFullYear() % 100),

        MMMM: monthLabels[month].getValue(locale),
        MM: pad(month + 1),
        M: String(month + 1),

        DD: pad(date.getDate()),
        D: String(date.getDate()),
        dddd: weekdayLabels[date.getDay() as Weekday].getValue(locale),

        HH: pad(hours),
        H: String(hours),
        hh: pad(amPmHours),
        h: String(amPmHours),

        mm: pad(date.getMinutes()),
        m: date.getMinutes().toString(),

        ss: pad(date.getSeconds()),
        s: date.getSeconds().toString(),

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