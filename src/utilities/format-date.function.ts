import { FormatDateFn } from './format-date-fn.model';

export const formatDate: FormatDateFn = (date, includeTime: boolean = false) => {
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