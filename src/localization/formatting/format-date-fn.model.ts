import { LanguageCode } from '../models';

/**
 * Function for formatting dates.
 */
export type FormatDateFn = (date: Date, includeTime?: boolean, language?: LanguageCode) => string;