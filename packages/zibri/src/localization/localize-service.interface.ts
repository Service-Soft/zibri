import { CurrencyCode } from './models/currency-code.model.ts';
import { DateFormatShortcut, DateFormatString } from './models/date-format.model.ts';
import { LocaleCode } from './models/locale-code.model.ts';
import { Timezone } from './models/timezone.model.ts';
import { HttpRequestContext } from '../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../context/request/websocket-request.context.ts';
import { AnyNumber } from '../data-source/models/where/number-where-filter.model.ts';

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
     * Gets how many decimals an amount in the given currency has, eg. 2 for EUR, 0 for JPY and 3 for KWD.
     * A price is formatted with them, and an amount that is calculated is rounded to them.
     */
    getCurrencyMinorUnits: (currency: CurrencyCode) => number,
    /**
     * Formats the given price, with the minor units of its currency.
     */
    formatPrice: (price: AnyNumber, options: FormatPriceOptions) => string,
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
    ) => string,
    /**
     * Orders two texts the way the default locale does.
     *
     * Which text sorts after which is a question about a language - Swedish sorts `ä` after `z`
     * where German sorts it with `a` - so it is answered here rather than by whatever is comparing. Every
     * data source is held to this one answer: a postgres text column is created with the matching
     * collation, and anything comparing in process calls this.
     *
     * Returns a negative number when the first text sorts first, a positive one when it sorts last,
     * and zero when the two sort the same.
     */
    compareText: (a: string, b: string) => number
}