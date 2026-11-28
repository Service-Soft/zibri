import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { AnyNumber } from '../data-source/models/where/number-where-filter.model';
import { CurrencyCode } from './models/currency-code.model';
import { DateFormatShortcut, DateFormatString } from './models/date-format.model';
import { LocaleCode } from './models/locale-code.model';
import { Timezone } from './models/timezone.model';

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
     * The currency code to use. Defaults to the currency of `locale`, or with `priceCurrency: 'defaultLocale'` of
     * the localize options to the one of the default locale.
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
    locale?: LocaleCode,
    /**
     * The time zone to read the date in, deciding which calendar day and hour it lands on.
     * Defaults to the `defaultTimezone` of the localize options.
     */
    timezone?: Timezone
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
     * Resolves the locale to translate and format in: the one of `runInLocale` while inside it, else the one the
     * given request asks for. Falls back to the default locale.
     */
    resolveSupportedLocale: (context: HttpRequestContext | WebsocketRequestContext | undefined) => LocaleCode,
    /**
     * Runs the given function in a locale: `$ts`, `$f`, the formatting methods and every template rendered inside
     * it, every await included, use it in place of the locale of the request. The locale is matched to a supported
     * one, so `de-AT` runs in `de`. One that matches none, null and undefined run in the default locale. A locale
     * set inside another replaces it for as long as the inner function runs.
     *
     * Optional until 4.0: call it through the function `runInLocale`, which runs the function as it is for a
     * localize service without it.
     */
    runInLocale?: <T>(locale: LocaleCode | null | undefined, fn: () => T) => T,
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
     * Gets how many decimals an amount in the given currency has, eg. 2 for EUR, 0 for JPY and 3 for KWD.
     * A price is formatted with them, and an amount that is calculated is rounded to them.
     */
    getCurrencyMinorUnits: (currency: CurrencyCode) => number,
    /**
     * Formats the given price, with the minor units of its currency. Without a currency, the price is in the
     * currency of the locale it is formatted in, or with `priceCurrency: 'defaultLocale'` of the localize options
     * in the one of the default locale, whichever locale it is formatted in.
     */
    formatPrice: (price: AnyNumber, options: FormatPriceOptions) => string,
    /**
     * Formats a percent, such as 19 for 19 %, with up to three decimals.
     */
    formatPercent: (percent: number, options?: FormatPercentOptions) => string,
    /**
     * Formats the given date.
     */
    formatDate: <const S extends string>(
        date: Date,
        format?: DateFormatString<S> | DateFormatShortcut,
        options?: FormatDateOptions
    ) => string,
    /**
     * Orders two texts the way the default locale does.
     *
     * Which text sorts after which is a question about a language - Swedish sorts `ä` after `z`
     * where German sorts it with `a`. Every data source orders text by this one answer, and anything
     * comparing in process calls this.
     *
     * Returns a negative number when the first text sorts first, a positive one when it sorts last,
     * and zero when the two sort the same.
     */
    compareText: (a: string, b: string) => number
}