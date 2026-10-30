
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
import { AnyNumber } from '../data-source/models/where/number-where-filter.model';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { OnAppInit } from '../global/on-app-init.interface';
import { KnownHeader } from '../http/known-header.enum';
import { CurrencyCode } from './models/currency-code.model';
import { InternalError } from '../error-handling/internal-error.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { type FsPath, FsUtilities } from '../utilities/fs.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { optionalPeer } from '../utilities/optional-peer.function';
import { ExtractedTranslationString } from './xlf/models/extracted-translation-string.model';

// whitespace is allowed around the `;` of the weight (RFC 9110, 12.4.2)
const acceptLanguageRegex: RegExp = /((([A-Za-z]+(-[\dA-Za-z]+){0,2})|\*)([\t ]*;[\t ]*q=[01](\.\d+)?)?)*/g;

// every option is stated rather than left to its default, because the default of a comparison is the
// runtime's own locale - which would make the order a property of the machine the process runs on
/**
 * How a collator is built wherever text is ordered. Every option is stated.
 */
export const TEXT_COLLATOR_OPTIONS: Intl.CollatorOptions = {
    sensitivity: 'variant',
    numeric: false,
    caseFirst: 'false',
    ignorePunctuation: false
};

/**
 * Texts that locales order differently, wherever they order text differently at all.
 *
 * Every entry is part of a real tailoring of the unicode default. Swedish sorts `ä` after `z` where
 * German sorts it with `a`, Danish does the same to `ø`, Spanish puts `ñ` after `n`, Czech sorts
 * `ch` after `h`, Polish `ł` after `l`, Estonian moves `z` in front of `t`, Turkish keeps the `i`
 * with its dot apart from the one without, and French compares accents from the end of the word.
 * Two locales that order all of these the same way order text the same way, as far as anything short
 * of the collation tables themselves can tell.
 */
// eslint-disable-next-line cspell/spellchecker
const TEXT_ORDER_PROBE: string[] = 'a A ä æ å b c ch d h i ı İ l ł n ñ o ö ø s ß ss t u ü v w z Z cote coté côte côté'
    .split(' ');

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

    private textCollatorOfDefaultLocale: Intl.Collator | undefined;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS)
        private readonly options: LocalizeOptions,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.TRANSLATIONS_PATH)
        private readonly translationPath: FsPath
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(): Promise<void> {
        this.logger.info('Initializes localization for the locales');

        const supportedLocales: LocaleCode[] = ObjectUtilities.keys(this.options.supportedLocales);
        if (!supportedLocales.includes(this.options.defaultLocale)) {
            throw new InternalError(
                `The default locale "${this.options.defaultLocale}" is not part of the ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS supported locales`
            );
        }
        this.requireOneTextOrder(supportedLocales);
        const sourceXlfPath: FsPath = FsUtilities.getPath(this.translationPath, 'source.xlf');
        if (!await FsUtilities.exists(sourceXlfPath)) {
            // the translations folder belongs to the application, so an application that translates
            // nothing has none - and this file is the whole of what localization loads. Reading it
            // regardless made having nothing to translate a boot failure, reported as a bare ENOENT.
            this.logger.warn(`Found no translations at "${sourceXlfPath}" - every string is served as it was written`);
            return;
        }
        // past this line the application has said it translates something, so the parser the
        // translations are read with is asked for here, while it starts, and named for why
        optionalPeer('saxes', 'Translations');

        const translationStrings: ExtractedTranslationString[] = await this.resolveExtractedTranslationFromSourceXlf(sourceXlfPath);

        await this.registerTranslationsFromXlfFiles(translationStrings, supportedLocales);
        this.warnAboutMissingTranslations(supportedLocales, translationStrings);
        this.warnAboutLeftOutPlaceholders(supportedLocales, translationStrings);
    }

    // round-2 11 §L6: a translation reads `{name}` as a placeholder only where its source has one of
    // that name, and anything else in braces as text. A placeholder the translator misspelled is
    // therefore served as text and its value as nothing, which only this says
    private warnAboutLeftOutPlaceholders(
        supportedLocales: LocaleCode[],
        translationStrings: ExtractedTranslationString[]
    ): void {
        for (const locale of supportedLocales) {
            for (const translation of translationStrings) {
                const found: string | undefined = TranslationRegistry.findTranslation(locale, translation.source);
                if (found == undefined || found === translation.source) {
                    continue;
                }
                const kept: Set<string> = this.resolvePlaceholderNames(found);
                const leftOut: string[] = [...this.resolvePlaceholderNames(translation.source)].filter(name => !kept.has(name));
                if (leftOut.length) {
                    const placeholders: string = leftOut.map(name => `{${name}}`).join(', ');
                    this.logger.warn(
                        `The "${locale}" translation of "${translation.source}" leaves out ${placeholders}`
                        + ` (${translation.file}:${translation.line})`
                    );
                }
            }
        }
    }

    // the names `$t` substitutes, read the way it reads them: `{{` and `}}` are a brace of the text
    private resolvePlaceholderNames(text: string): Set<string> {
        return new Set([...text.matchAll(/{{|}}|{([^}]+)}/g)].flatMap(match => match[1] == undefined ? [] : [match[1]]));
    }

    private warnAboutMissingTranslations(
        supportedLocales: LocaleCode[],
        translationStrings: ExtractedTranslationString[]
    ): void {
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
            this.logger.warn(
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
            this.logger.info(`  - ${locale}`);

            const translationFilePath: FsPath = FsUtilities.getPath(this.translationPath, `${locale}.xlf`);
            if (!await FsUtilities.exists(translationFilePath)) {
                continue;
            }

            const xml: string = await FsUtilities.readFile(translationFilePath);
            const parsed: Record<string, string> = await parseTranslationXlf(xml);

            TranslationRegistry.translations[locale] ??= {};
            for (const [source, translation] of ObjectUtilities.entries(parsed)) {
                TranslationRegistry.translations[locale][source] = translation;
            }
        }
    }

    private async resolveExtractedTranslationFromSourceXlf(sourceXlfPath: FsPath): Promise<ExtractedTranslationString[]> {
        const sourceXlf: string = await FsUtilities.readFile(sourceXlfPath);
        return await parseSourceXlf(sourceXlf);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    compareText(a: string, b: string): number {
        return this.textCollator.compare(a, b);
    }

    /**
     * Refuses an application whose supported locales order text differently and does not say which
     * order is stored.
     *
     * One order is stored, and it is the default locale's - a column's collation belongs to the
     * schema, not to a request. When every supported locale agrees about text there is nothing to
     * decide and nothing is asked. When they do not, serving several languages out of one order is a
     * decision, and one nobody makes deliberately is one nobody knows was made.
     * @param supportedLocales - The locales the application declares.
     * @throws When two of them order text differently and `textOrder` says nothing.
     */
    private requireOneTextOrder(supportedLocales: LocaleCode[]): void {
        if (this.options.textOrder != undefined) {
            return;
        }
        const disagreeing: [LocaleCode, LocaleCode] | undefined = this.firstDisagreementOnTextOrder(supportedLocales);
        if (!disagreeing) {
            return;
        }
        throw new InternalError([
            `The supported locales "${disagreeing[0]}" and "${disagreeing[1]}" order text differently, and one order is`,
            `stored: every text is ordered by the default locale "${this.options.defaultLocale}", wherever it is stored.`,
            'Set `textOrder: \'defaultLocale\'` on ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS to say that is what you want.',
            'Ordering per request is not available - the collation would have to be named by every statement, which takes'
            + ' ordered reads off their index.'
        ]);
    }

    /**
     * The first two of the given locales that do not order text the same way.
     *
     * Read by ordering {@link TEXT_ORDER_PROBE} with each of them rather than out of the collation
     * tables, which no runtime api exposes: locales that put every text in it in the same order are
     * taken to agree. That can only miss a disagreement, never invent one - and missing one leaves
     * the order text is stored in exactly as it would have been anyway.
     * @param locales - The locales to compare.
     * @returns The first two that disagree, or undefined when they all agree.
     */
    private firstDisagreementOnTextOrder(locales: LocaleCode[]): [LocaleCode, LocaleCode] | undefined {
        const [first, ...rest]: LocaleCode[] = locales;
        if (first == undefined) {
            return undefined;
        }
        const order: string = this.textOrderOf(first);
        for (const locale of rest) {
            if (this.textOrderOf(locale) !== order) {
                return [first, locale];
            }
        }
        return undefined;
    }

    /**
     * The probe in the order one locale puts it in.
     * @param locale - The locale to order by.
     * @returns The ordered probe, as one text to hold against another locale's.
     */
    private textOrderOf(locale: LocaleCode): string {
        const collator: Intl.Collator = new Intl.Collator(locale, TEXT_COLLATOR_OPTIONS);
        return [...TEXT_ORDER_PROBE].sort((a, b) => collator.compare(a, b)).join('\0');
    }

    /**
     * The collator every text is ordered by, built once.
     * @returns The collator of the default locale.
     */
    private get textCollator(): Intl.Collator {
        this.textCollatorOfDefaultLocale ??= new Intl.Collator(this.options.defaultLocale, TEXT_COLLATOR_OPTIONS);
        return this.textCollatorOfDefaultLocale;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveSupportedLocale(
        context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT)
    ): LocaleCode {
        if (context?.has(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_LOCALE) === true) {
            return context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_LOCALE);
        }

        // a locale the query names twice names two, and picking one would be a guess - so it, like one
        // that names nothing supported, leaves the choice to the header
        const query: unknown = context?.request.query?.[this.options.localeQueryParam];
        const fromQuery: LocaleCode | undefined = typeof query === 'string' && query.length
            ? this.resolveSupportedLocaleFromAcceptLanguageString(query)
            : undefined;
        if (fromQuery) {
            return fromQuery;
        }

        const acceptLanguage: string | undefined = context?.request.headers?.[KnownHeader.ACCEPT_LANGUAGE];
        const fromHeader: LocaleCode | undefined = acceptLanguage
            ? this.resolveSupportedLocaleFromAcceptLanguageString(acceptLanguage)
            : undefined;
        return fromHeader ?? this.options.defaultLocale;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveSupportedLocaleFromAcceptLanguageString(acceptLanguage: string): LocaleCode | undefined {
        const parts: RegExpMatchArray | null = acceptLanguage.match(acceptLanguageRegex);
        const resolvedDefinitions: AcceptLanguageDefinition[] = (parts ?? []).map(m => {
            const bits: string[] = m.split(';').map(bit => bit.trim());
            const ietf: string[] = (bits[0] ?? '').split('-');
            const hasScript: boolean = ietf.length === 3;
            // the regex only matches a parameter written as `;q=`, so a second bit always has one
            const quality: string | undefined = bits[1]?.split('=')[1];

            return {
                language: ietf[0] ?? '',
                script: hasScript ? ietf[1] : undefined,
                region: hasScript ? ietf[2] : ietf[1],
                quality: quality == undefined ? 1 : Number.parseFloat(quality)
            };
        })
            // a weight of 0 says the language is not acceptable at all
            .filter(definition => definition.quality > 0)
            .sort((a, b) => b.quality - a.quality);

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
    getCurrencyMinorUnits(currency: CurrencyCode): number {
        // eslint-disable-next-line stylistic/max-len
        const res: number | undefined = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
        // set for every currency format, and optional in the type only for the formats rounding by
        // significant digits instead
        if (res == undefined) {
            throw new InternalError(`Could not resolve the minor units of currency "${currency}"`);
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    formatPrice(price: AnyNumber, options: FormatPriceOptions): string {
        // read rather than filled in: a caller passing one options object to every call would otherwise
        // format each later call in the locale of the first
        const locale: LocaleCode = options.locale ?? this.resolveSupportedLocale();
        const currency: CurrencyCode = options.currency ?? this.resolveCurrencyCodeForLocale(locale);

        const v: number | bigint = typeof price === 'number' || typeof price === 'bigint' ? price : price.toNumber();
        // the minor units asked for rather than left to the runtime, so a price shows the decimals an
        // amount calculated in its currency was rounded to, whoever answers how many those are
        const minorUnits: number = this.getCurrencyMinorUnits(currency);
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: minorUnits,
            maximumFractionDigits: minorUnits
        }).format(v);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    formatPercent(percent: number, options: FormatPercentOptions = {}): string {
        return percent.toLocaleString(options.locale ?? this.resolveSupportedLocale(), { style: 'percent' });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    formatDate<const S extends string>(
        date: Date,
        format: DateFormatString<S> | DateFormatShortcut = 'date',
        options: FormatDateOptions = {}
    ): string {
        const locale: LocaleCode = options.locale ?? this.resolveSupportedLocale();

        const formatString: DateFormatString<S> = format === 'date' || format === 'date-time' || format === 'time'
            ? this.resolveDateFormatForLocale(locale, format as DateFormatShortcut)
            : format;

        return formatDate(date, formatString, locale, options.timezone ?? this.options.defaultTimezone);
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