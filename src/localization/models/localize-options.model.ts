import { CurrencyCode } from './currency-code.model';
import { DefinedDateFormatString } from './date-format.model';
import { LocaleCode } from './locale-code.model';

/**
 * Configuration for a single supported locale.
 */
export type LocaleConfiguration = {
    /**
     * The currency code of the locale, like eg. 'USD'.
     */
    currencyCode: CurrencyCode,
    /**
     * The default to use for the format 'date'.
     */
    defaultDateFormat: DefinedDateFormatString,
    /**
     * The default to use for the format 'date-time'.
     */
    defaultDateTimeFormat: DefinedDateFormatString,
    /**
     * The default to use for the format 'time'.
     */
    defaultTimeFormat: DefinedDateFormatString
};

/**
 * The options for handling localization, eg. In date or currency formatting.
 */
export type LocalizeOptions = {
    /**
     * The locale code to use by default.
     */
    readonly defaultLocale: LocaleCode,
    /**
     * Configuration on all the supported locales.
     */
    readonly supportedLocales: Partial<Record<LocaleCode, LocaleConfiguration>>,
    /**
     * The query parameter to resolve the locale from before the accept language header is used.
     */
    readonly localeQueryParam: string
};

/**
 * Input for modifying the localize options.
 */
export type LocalizeOptionsInput = Partial<LocalizeOptions>;