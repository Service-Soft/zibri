import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts, testFileFolder } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider, DiProvider } from '../di/models/di-provider.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { type FsPath, FsUtilities } from '../utilities/fs.utilities';
import { defineDateFormat } from './define-date-format.function';
import { LocalizeServiceInterface } from './localize-service.interface';
import { LocalizeService } from './localize.service';
import { LocaleConfiguration, type LocalizeOptions } from './models/localize-options.model';
import { runInLocale } from './run-in-locale.function';
import { $t, $ts } from './translate.function';
import { generateSourceXlf } from './xlf/generate-source-xlf.function';

/**
 * A localize service an application of 3.2 wrote keeps working: a class extending `LocalizeService` with the
 * constructor of 3.2, and a `LocalizeServiceInterface` of its own without `runInLocale`. A price without a currency
 * is in the currency of the locale formatting it, as in 3.2.
 */

const workDir: FsPath = FsUtilities.getPath(testFileFolder, 'localize-compatibility');
const translationsDir: FsPath = FsUtilities.getPath(workDir, 'translations');
// a package of zibri, of which only what the localization reads
const zibriRoot: FsPath = FsUtilities.getPath(workDir, 'zibri');

const english: LocaleConfiguration = {
    currencyCode: 'USD',
    defaultDateFormat: defineDateFormat('MM/DD/YYYY'),
    defaultDateTimeFormat: defineDateFormat('MM/DD/YYYY h:mm A'),
    defaultTimeFormat: defineDateFormat('h:mm A')
};

const german: LocaleConfiguration = {
    currencyCode: 'EUR',
    defaultDateFormat: defineDateFormat('DD.MM.YYYY'),
    defaultDateTimeFormat: defineDateFormat('DD.MM.YYYY HH:mm'),
    defaultTimeFormat: defineDateFormat('HH:mm')
};

// the space Intl puts between an amount and a symbol written after it
const NBSP: string = ' ';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

/**
 * A localize service as an application of 3.2 extended it, with the constructor of 3.2.
 */
class LocalizeServiceOf32 extends LocalizeService {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS)
        options: LocalizeOptions,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.TRANSLATIONS_PATH)
        translationPath: FsPath
    ) {
        super(options, logger, translationPath);
    }
}

/**
 * A localize service as an application of 3.2 implemented it, without `runInLocale`, handing every call to the one
 * of zibri.
 */
class OwnLocalizeServiceOf32 implements LocalizeServiceInterface {
    readonly resolveSupportedLocale: LocalizeServiceInterface['resolveSupportedLocale'];
    readonly resolveSupportedLocaleFromAcceptLanguageString: LocalizeServiceInterface['resolveSupportedLocaleFromAcceptLanguageString'];
    readonly resolveCurrencyCodeForLocale: LocalizeServiceInterface['resolveCurrencyCodeForLocale'];
    readonly resolveDateFormatForLocale: LocalizeServiceInterface['resolveDateFormatForLocale'];
    readonly getCurrencyMinorUnits: LocalizeServiceInterface['getCurrencyMinorUnits'];
    readonly formatPrice: LocalizeServiceInterface['formatPrice'];
    readonly formatPercent: LocalizeServiceInterface['formatPercent'];
    readonly formatDate: LocalizeServiceInterface['formatDate'];
    readonly compareText: LocalizeServiceInterface['compareText'];

    constructor(inner: LocalizeService) {
        this.resolveSupportedLocale = inner.resolveSupportedLocale.bind(inner);
        this.resolveSupportedLocaleFromAcceptLanguageString = inner.resolveSupportedLocaleFromAcceptLanguageString.bind(inner);
        this.resolveCurrencyCodeForLocale = inner.resolveCurrencyCodeForLocale.bind(inner);
        this.resolveDateFormatForLocale = inner.resolveDateFormatForLocale.bind(inner);
        this.getCurrencyMinorUnits = inner.getCurrencyMinorUnits.bind(inner);
        this.formatPrice = inner.formatPrice.bind(inner);
        this.formatPercent = inner.formatPercent.bind(inner);
        this.formatDate = inner.formatDate.bind(inner);
        this.compareText = inner.compareText.bind(inner);
    }
}

let server: StartedTestServer | undefined;

/**
 * Starts an application supporting `en-US` and `de` with a localize service.
 * @param localizeService - The provider of the localize service.
 * @returns The application.
 */
async function startWith(localizeService: DiProvider<LocalizeServiceInterface>): Promise<StartedTestServer> {
    return await startTestServer({
        dataSources: [dataSourceClass],
        providers: [
            ...defaultTestServerProviders,
            localizeService,
            defineProvider({ token: ZIBRI_DI_TOKENS.TRANSLATIONS_PATH, useValue: translationsDir }),
            defineProvider({ token: ZIBRI_DI_TOKENS.ZIBRI_PACKAGE_ROOT, useValue: zibriRoot }),
            defineProvider({
                token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
                useValue: { defaultLocale: 'en-US', supportedLocales: { 'en-US': english, de: german } }
            })
        ]
    });
}

beforeAll(async () => {
    // the string of the framework, as the build of the application finds it
    await FsUtilities.createFile(FsUtilities.getPath(workDir, 'src', 'strings.ts'), ['export const invalid = () => $t`The token is invalid.`;']);
    await generateSourceXlf(workDir, [{ origin: 'project', originLocale: 'en-US', patterns: `${workDir}/src/**/*.ts` }]);
    await FsUtilities.createFile(FsUtilities.getPath(zibriRoot, 'package.json'), JSON.stringify({
        name: 'zibri',
        translations: { de: './translations/de.xlf' }
    }));
    await FsUtilities.createFile(FsUtilities.getPath(zibriRoot, 'translations', 'de.xlf'), [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">',
        '  <file source-language="en-US" target-language="de" datatype="plaintext" original="zibri">',
        '    <body>',
        '      <trans-unit id="The token is invalid." xml:space="preserve">',
        '        <source>The token is invalid.</source>',
        '        <target>Das Token ist ungültig.</target>',
        '      </trans-unit>',
        '    </body>',
        '  </file>',
        '</xliff>'
    ]);
});

afterAll(async () => {
    await FsUtilities.rm(workDir);
});

describe('a class extending LocalizeService with the constructor of 3.2', () => {
    beforeAll(async () => {
        server = await startWith({ token: ZIBRI_DI_TOKENS.LOCALIZE_SERVICE, useClass: LocalizeServiceOf32 });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('starts, and serves the German zibri ships of its own strings', () => {
        expect(inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE)).toBeInstanceOf(LocalizeServiceOf32);
        expect($t`The token is invalid.`.getValue('de')).toBe('Das Token ist ungültig.');
    });

    it('runs work in a locale', () => {
        expect(runInLocale('de', () => $ts`The token is invalid.`)).toBe('Das Token ist ungültig.');
    });

    it('formats a price without a currency in the currency of the locale formatting it, as in 3.2', () => {
        const localizeService: LocalizeServiceInterface = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE);

        expect(localizeService.formatPrice(19.99, { locale: 'en-US' })).toBe('$19.99');
        expect(localizeService.formatPrice(19.99, { locale: 'de' })).toBe(`19,99${NBSP}€`);
        expect(runInLocale('de', () => localizeService.formatPrice(19.99, { locale: localizeService.resolveSupportedLocale(undefined) })))
            .toBe(`19,99${NBSP}€`);
    });
});

describe('a LocalizeServiceInterface of 3.2, without runInLocale', () => {
    beforeAll(async () => {
        server = await startWith({
            token: ZIBRI_DI_TOKENS.LOCALIZE_SERVICE,
            useFactory: () => new OwnLocalizeServiceOf32(new LocalizeService(
                inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS),
                inject(ZIBRI_DI_TOKENS.LOGGER),
                inject(ZIBRI_DI_TOKENS.TRANSLATIONS_PATH)
            ))
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('runs the work of runInLocale as it is, in the locale the service resolves', () => {
        const localizeService: LocalizeServiceInterface = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE);

        expect(localizeService.runInLocale).toBeUndefined();
        expect(runInLocale('de', () => localizeService.resolveSupportedLocale(undefined))).toBe('en-US');
    });
});