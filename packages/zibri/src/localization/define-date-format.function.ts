import { DateFormatString, DefinedDateFormatString } from './models/date-format.model';

/**
 * Helper that validates a date format string at compile time.
 * @param format - The date format string.
 * @returns A validated date format string.
 */
export function defineDateFormat<S extends string>(format: DateFormatString<S>): DefinedDateFormatString {
    return format as unknown as DefinedDateFormatString;
}