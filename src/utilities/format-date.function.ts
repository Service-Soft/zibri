import { FormatDateFn } from './format-date-fn.model';

/**
 * Default implementation for formatting dates.
 * @param date - The date to format.
 * @param includeTime - Whether or not time should be included. Defaults to false.
 */
export const formatDate: FormatDateFn = (date: Date, includeTime: boolean = false) => {
    if (includeTime) {
        return new Date(date).toLocaleDateString(
            'de',
            {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }
        );
    }
    return new Date(date).toLocaleDateString(
        'de',
        {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }
    );
};