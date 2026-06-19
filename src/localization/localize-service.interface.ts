import { CurrencyCode } from './models/currency-code.model';
import { DateFormatShortcut, DateFormatString } from './models/date-format.model';
import { LocaleCode } from './models/locale-code.model';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { BigNumber } from '../utilities/number.utilities';

/**
 * The options for formatting a price.
 * Either the currency code or the locale have to be provided.
 */
export type FormatPriceOptions = {
    /**
     * The currency code to use.
     */
    currency: CurrencyCode,
    /**
     * The locale to use.
     */
    locale?: LocaleCode
} | {
    /**
     * The currency code to use.
     */
    currency?: CurrencyCode,
    /**
     * The locale to use.
     */
    locale: LocaleCode
};

/**
 * Options for formatting a date.
 */
export type FormatDateOptions = {
    /**
     * The locale to use.
     */
    locale?: LocaleCode
};

/**
 * Options for formatting a percentage value.
 */
export type FormatPercentOptions = {
    /**
     * The locale to use.
     */
    locale?: LocaleCode
};

/**
 * Interface for a localize service.
 */
export interface LocalizeServiceInterface {
    /**
     * Resolves a supported locale from the given context. Falls back to the default locale.
     */
    resolveSupportedLocale: (context: HttpRequestContext | WebsocketRequestContext | undefined) => LocaleCode,
    /**
     * Resolves a supported locale from the given accept language header string.
     */
    resolveSupportedLocaleFromAcceptLanguageString: (acceptLanguage: string) => LocaleCode | undefined,
    /**
     * Resolves the currency code for the given locale.
     */
    resolveCurrencyCodeForLocale: (locale: LocaleCode) => CurrencyCode,
    /**
     * Resolves the default date format for the given locale and date format variant.
     */
    resolveDateFormatForLocale: <const S extends string>(
        locale: LocaleCode,
        variant: DateFormatShortcut
    ) => DateFormatString<S>,
    /**
     * Formats the given price.
     */
    formatPrice: (price: number | bigint | BigNumber, options: FormatPriceOptions) => string,
    /**
     * Format the given percentage value.
     */
    formatPercent: (percent: number, options?: FormatPercentOptions) => string,
    /**
     * Formats the given date.
     */
    formatDate: <const S extends string>(
        date: Date,
        format?: DateFormatString<S> | DateFormatShortcut,
        options?: FormatDateOptions
    ) => string
}