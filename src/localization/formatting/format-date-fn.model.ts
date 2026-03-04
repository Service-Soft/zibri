import { LanguageCode } from '../models/language-code.model';

/**
 * Function for formatting dates.
 */
export type FormatDateFn = (date: Date, includeTime?: boolean, language?: LanguageCode) => string;