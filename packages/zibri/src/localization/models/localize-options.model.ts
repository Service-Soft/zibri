import { CurrencyCode } from './currency-code.model.ts';
import { DefinedDateFormatString } from './date-format.model.ts';
import { LocaleCode } from './locale-code.model.ts';
import { Timezone } from './timezone.model.ts';

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
    readonly localeQueryParam: string,
    /**
     * The time zone anything scheduled or formatted is read in unless it names its own.
     *
     * Defaults to UTC rather than to whatever the machine is set to, so that the same instruction
     * means the same moment wherever it runs. A local zone is part of the environment, which makes
     * "03:00" one thing on a laptop and another in production - and a thing that moves twice a year
     * anywhere observing daylight saving.
     */
    readonly defaultTimezone: Timezone,
    /**
     * What text is ordered by, for an application whose supported locales do not agree about it.
     *
     * Which text sorts after which is a question about a language - Swedish sorts `ä` after `z`
     * where German sorts it with `a`. The default locale answers it for the whole application, and a
     * postgres text column is created with the matching collation while anything comparing in
     * process follows the same rule - so an order, a page of a keyset walk and an `after` filter
     * agree wherever they run.
     *
     * Only needed when the supported locales order text differently, and then it is **required**:
     * serving several languages and storing one order is a decision, and one nobody makes by
     * accident is one nobody knows was made. Ordering per request is deliberately not available -
     * the collation would have to be named by every statement, which takes ordered reads off their
     * index - so there is one value to name today.
     */
    readonly textOrder?: 'defaultLocale'
};

/**
 * Input for modifying the localize options.
 */
export type LocalizeOptionsInput = Partial<LocalizeOptions>;