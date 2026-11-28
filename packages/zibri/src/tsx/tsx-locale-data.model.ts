import { LocaleData } from 'zibri-tsx';

import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { LocalizeServiceInterface } from '../localization/localize-service.interface';
import { CurrencyCode } from '../localization/models/currency-code.model';
import { LocaleCode } from '../localization/models/locale-code.model';
import { LocalizeOptions } from '../localization/models/localize-options.model';
import { TranslationRegistry } from '../localization/translation.registry';

/**
 * The format data the client side `$f` hook is built from.
 */
type LocaleFormatOptions = {
    /**
     * The active locale, used for number and currency formatting.
     */
    locale: LocaleCode,
    /**
     * The date format for the active locale.
     */
    dateFormat: string,
    /**
     * The time format for the active locale.
     */
    timeFormat: string,
    /**
     * The combined date time format for the active locale.
     */
    dateTimeFormat: string,
    /**
     * The currency a price without one is in: the one of the active locale, or with `priceCurrency:
     * 'defaultLocale'` of the localize options the one of the default locale.
     */
    currencyCode: CurrencyCode
};

/**
 * Translations by locale, then by source string.
 */
type ClientTranslations = Partial<Record<LocaleCode, Partial<Record<string, string>>>>;

/**
 * Supplies the locale data that the client side `$t`, `$ts` and `$f` hooks are inlined with.
 *
 * Every value is resolved lazily through a getter, because zibri-tsx only reads them when the page
 * actually references one of those hooks. A page that has no localized client code therefore never
 * touches the localize service at all.
 */
export class TsxLocaleData implements LocaleData {
    private resolvedLocale: LocaleCode | undefined;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The locale the current request resolves to.
     */
    get locale(): string {
        return this.currentLocale();
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The translations the client gets access to.
     *
     * Every registered locale is sent, not just the active one: a `$t` token can be resolved for any
     * locale through ``$t`...`.getValue(locale)``, which is exactly what sets it apart from `$ts`.
     * Limiting this to the active locale would silently fall back to the source string.
     */
    get translations(): ClientTranslations {
        return TranslationRegistry.translations;
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The date, time and currency formats for the active locale.
     */
    get formatOptions(): LocaleFormatOptions {
        const localizeService: LocalizeServiceInterface = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE);
        const localizeOptions: LocalizeOptions = inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS);
        const locale: LocaleCode = this.currentLocale();

        return {
            locale,
            dateFormat: localizeService.resolveDateFormatForLocale(locale, 'date'),
            timeFormat: localizeService.resolveDateFormatForLocale(locale, 'time'),
            dateTimeFormat: localizeService.resolveDateFormatForLocale(locale, 'date-time'),
            // the one formatPrice takes on the server
            currencyCode: localizeService.resolveCurrencyCodeForLocale(
                localizeOptions.priceCurrency === 'defaultLocale' ? localizeOptions.defaultLocale : locale
            )
        };
    }

    /**
     * Resolves the locale of the current request once and caches it, so the getters above stay
     * consistent with each other.
     * @returns The resolved locale.
     */
    private currentLocale(): LocaleCode {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(
            ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT
        );
        this.resolvedLocale ??= inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(context);
        return this.resolvedLocale;
    }
}