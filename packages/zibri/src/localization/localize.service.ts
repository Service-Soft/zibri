
import { formatDate } from './format-date.function';
import { FormatDateOptions, FormatPercentOptions, FormatPriceOptions, LocalizeServiceInterface } from './localize-service.interface';
import { DateFormatShortcut, DateFormatString, DefinedDateFormatString } from './models/date-format.model';
import { LocaleCode, resolveLocaleCode } from './models/locale-code.model';
import { type LocalizeOptions } from './models/localize-options.model';
import { TranslationRegistry } from './translation.registry';
import { parseSourceXlf } from './xlf/parse-source-xlf.function';
import { parseTranslationXlf } from './xlf/parse-translation-xlf.function';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { OnAppInit } from '../global/on-app-init.interface';
import { KnownHeader } from '../http/known-header.enum';
import { BigNumber } from '../utilities/number.utilities';
import { CurrencyCode } from './models/currency-code.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { ExtractedTranslationString } from './xlf/transform-source-translation-tokens.function';
import { InternalError } from '../error-handling/internal-error.model';

const acceptLanguageRegex: RegExp = /((([A-Za-z]+(-[\dA-Za-z]+){0,2})|\*)(;q=[01](\.\d+)?)?)*/g;

/**
 * Definition of a accept language header part.
 */
type AcceptLanguageDefinition = {
    /**
     * The language.
     */
    language: string,
    /**
     * The script.
     */
    script: string | undefined,
    /**
     * The region.
     */
    region: string | undefined,
    /**
     * The quality.
     */
    quality: number
};

/**
 * Default localize service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class LocalizeService implements LocalizeServiceInterface, OnAppInit {

    private readonly translationPath: FsPath = FsUtilities.getPath(__dirname, 'translations');

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS)
        private readonly options: LocalizeOptions,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(): Promise<void> {
        await this.logger.info('Initializes localization for the locales');

        const supportedLocales: LocaleCode[] = ObjectUtilities.keys(this.options.supportedLocales);
        if (!supportedLocales.includes(this.options.defaultLocale)) {
            throw new InternalError(
                `The default locale "${this.options.defaultLocale}" is not part of the ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS supported locales`
            );
        }
        const translationStrings: ExtractedTranslationString[] = await this.resolveExtractedTranslationFromSourceXlf();

        await this.registerTranslationsFromXlfFiles(translationStrings, supportedLocales);
        await this.warnAboutMissingTranslations(supportedLocales, translationStrings);
    }

    private async warnAboutMissingTranslations(
        supportedLocales: LocaleCode[],
        translationStrings: ExtractedTranslationString[]
    ): Promise<void> {
        const missingTranslations: Map<ExtractedTranslationString, LocaleCode[]> = new Map();

        // check for missing translations
        for (const locale of supportedLocales) {
            for (const translation of translationStrings) {
                const foundTranslation: string | undefined = TranslationRegistry.findTranslation(locale, translation.source);
                if (!foundTranslation) {
                    const missingLocales: LocaleCode[] = missingTranslations.get(translation) ?? [];
                    missingLocales.push(locale);
                    missingTranslations.set(translation, missingLocales);
                }
            }
        }

        for (const [translation, locales] of missingTranslations.entries()) {
            await this.logger.warn(
                // eslint-disable-next-line stylistic/max-len
                `Missing translation of "${translation.source}" for ${locales.length > 1 ? 'locales' : 'locale'} "${locales.join()}" (${translation.file}:${translation.line})`
            );
        }
    }

    private async registerTranslationsFromXlfFiles(
        translationStrings: ExtractedTranslationString[],
        supportedLocales: LocaleCode[]
    ): Promise<void> {
        for (const translationString of translationStrings) {
            const locale: LocaleCode = translationString.sourceLocale as LocaleCode;
            TranslationRegistry.translations[locale] ??= {};
            TranslationRegistry.translations[locale][translationString.source] = translationString.source;
        }

        for (const locale of supportedLocales) {
            await this.logger.info(`  - ${locale}`);

            const translationFilePath: FsPath = FsUtilities.getPath(this.translationPath, `${locale}.xlf`);
            if (!await FsUtilities.exists(translationFilePath)) {
                continue;
            }

            const xml: string = await FsUtilities.readFile(translationFilePath);
            const parsed: Record<string, string> = parseTranslationXlf(xml);

            TranslationRegistry.translations[locale] ??= {};
            for (const [source, translation] of ObjectUtilities.entries(parsed)) {
                TranslationRegistry.translations[locale][source] = translation;
            }
        }
    }

    private async resolveExtractedTranslationFromSourceXlf(): Promise<ExtractedTranslationString[]> {
        const sourceXlf: string = await FsUtilities.readFile(FsUtilities.getPath(this.translationPath, 'source.xlf'));
        return parseSourceXlf(sourceXlf);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveSupportedLocale(
        context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT)
    ): LocaleCode {
        if (context?.has(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_LOCALE) === true) {
            return context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_LOCALE);
        }

        const acceptLanguage: string | undefined = context?.request.query?.[this.options.localeQueryParam]
            ?? context?.request.headers?.[KnownHeader.ACCEPT_LANGUAGE];
        if (!acceptLanguage) {
            return this.options.defaultLocale;
        }

        const resolvedLocale: LocaleCode | undefined = this.resolveSupportedLocaleFromAcceptLanguageString(acceptLanguage);
        if (resolvedLocale) {
            return resolvedLocale;
        }

        return this.options.defaultLocale;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveSupportedLocaleFromAcceptLanguageString(acceptLanguage: string): LocaleCode | undefined {
        const parts: RegExpMatchArray | null = acceptLanguage.match(acceptLanguageRegex);
        const resolvedDefinitions: AcceptLanguageDefinition[] = (parts ?? []).map(m => {
            const bits: string[] = m.split(';');
            const ietf: string[] = bits[0].split('-');
            const hasScript: boolean = ietf.length === 3;

            return {
                language: ietf[0],
                script: hasScript ? ietf[1] : undefined,
                region: hasScript ? ietf[2] : ietf[1],
                quality: bits[1] ? Number.parseFloat(bits[1].split('=')[1]) : 1
            };
        }).sort((a, b) => b.quality - a.quality);

        for (const definition of resolvedDefinitions) {
            const locale: LocaleCode | undefined = this.findSupportedLocaleForAcceptLanguageDefinition(definition);
            if (locale) {
                return locale;
            }
        }

        return undefined;
    }

    private findSupportedLocaleForAcceptLanguageDefinition(definition: AcceptLanguageDefinition): LocaleCode | undefined {
        const localeScript: string = definition.script ? `-${definition.script}` : '';
        const localeRegion: string = definition.region ? `-${definition.region}` : '';
        const locale: LocaleCode = `${definition.language}${localeScript}${localeRegion}` as LocaleCode;

        return resolveLocaleCode(locale, ObjectUtilities.keys(this.options.supportedLocales));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveCurrencyCodeForLocale(locale: LocaleCode): CurrencyCode {
        const currency: CurrencyCode | undefined = this.options.supportedLocales[locale]?.currencyCode;
        if (currency == undefined) {
            throw new InternalError(`Could not resolve currency for locale "${locale}"`);
        }
        return currency;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    formatPrice(price: number | bigint | BigNumber, options: FormatPriceOptions): string {
        options.locale ??= this.resolveSupportedLocale();
        options.currency ??= this.resolveCurrencyCodeForLocale(options.locale);

        const v: number | bigint = typeof price === 'number' || typeof price === 'bigint' ? price : price.toNumber();
        return v.toLocaleString(options.locale, { style: 'currency', currency: options.currency });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    formatPercent(percent: number, options: FormatPercentOptions = {}): string {
        options.locale ??= this.resolveSupportedLocale();
        return percent.toLocaleString(options.locale, { style: 'percent' });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    formatDate<const S extends string>(
        date: Date,
        format: DateFormatString<S> | DateFormatShortcut = 'date',
        options: FormatDateOptions = {}
    ): string {
        options.locale ??= this.resolveSupportedLocale();

        const formatString: DateFormatString<S> = format === 'date' || format === 'date-time' || format === 'time'
            ? this.resolveDateFormatForLocale(options.locale, format as DateFormatShortcut)
            : format;

        return formatDate(date, formatString, options.locale);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveDateFormatForLocale<const S extends string>(
        locale: LocaleCode,
        variant: DateFormatShortcut
    ): DateFormatString<S> {
        let format: DefinedDateFormatString | undefined;
        switch (variant) {
            case 'date': {
                format = this.options.supportedLocales[locale]?.defaultDateFormat;
                break;
            }
            case 'date-time': {
                format = this.options.supportedLocales[locale]?.defaultDateTimeFormat;
                break;
            }
            case 'time': {
                format = this.options.supportedLocales[locale]?.defaultTimeFormat;
                break;
            }
        }

        if (format == undefined) {
            throw new InternalError(`Could not resolve default "${variant}" format for locale "${locale}"`);
        }

        return format as unknown as DateFormatString<S>;
    }
}