import { FormatDateFn } from './format-date-fn.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { LanguageCode } from '../models/language-code.model';

/**
 * Default implementation for formatting dates.
 * @param date - The date to format.
 * @param includeTime - Whether or not time should be included. Defaults to false.
 * @param language - The language code to be used for formatting. Defaults to the language provided in ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS.
 */
export const formatDate: FormatDateFn = (
    date: Date,
    includeTime: boolean = false,
    language: LanguageCode = inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).language
) => {
    if (includeTime) {
        return new Date(date).toLocaleDateString(
            language,
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
        language,
        {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }
    );
};