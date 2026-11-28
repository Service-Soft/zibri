import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts, testFileFolder } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { KnownHeader } from '../http/known-header.enum';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { defineDateFormat } from './define-date-format.function';
import { $f } from './format.function';
import { LocalizeServiceInterface } from './localize-service.interface';
import { LocalizeService } from './localize.service';
import { LocaleCode } from './models/locale-code.model';
import { LocaleConfiguration } from './models/localize-options.model';
import { $ts } from './translate.function';
import { generateSourceXlf } from './xlf/generate-source-xlf.function';

/**
 * Work outside a request, such as a cron job mailing each user, translates and formats in the locale it is run
 * in, and with `priceCurrency: 'defaultLocale'` a price keeps the currency of the default locale in every language.
 */

const workDir: FsPath = FsUtilities.getPath(testFileFolder, 'localize-locale-scope');
const translationsDir: FsPath = FsUtilities.getPath(workDir, 'translations');

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

const DAY: Date = new Date('2026-06-13T12:00:00.000Z');

// the space Intl puts between an amount and a symbol written after it
const NBSP: string = ' ';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

/**
 * What a request translates and formats in a scope of its own.
 */
type ScopedFormatted = {
    greeting: string,
    price: string,
    requestLocale: LocaleCode
};

/**
 * What a request translates and formats.
 */
type Formatted = {
    scoped: ScopedFormatted,
    greeting: string,
    price: string,
    priceInEuro: string
};

@Controller('/formatted')
class FormattedController {
    @Get()
    format(): Formatted {
        const localize: LocalizeService = localizeService();
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        // before anything else, so that the locale the request asks for is first read inside the scope
        const scoped: ScopedFormatted = localize.runInLocale('en-US', () => ({
            greeting: $ts`Welcome`,
            price: localize.formatPrice(19.99, { locale: localize.resolveSupportedLocale(context) }),
            requestLocale: context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_LOCALE) ?? 'en-US'
        }));
        return {
            scoped,
            greeting: $ts`Welcome`,
            price: localize.formatPrice(19.99, { locale: localize.resolveSupportedLocale(context) }),
            priceInEuro: $f.price(19.99, 'EUR')
        };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * The localize service of the running application, the one zibri ships, whose `runInLocale` this suite is about.
 * @returns The service.
 */
function localizeService(): LocalizeService {
    const service: LocalizeServiceInterface = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE);
    if (!(service instanceof LocalizeService)) {
        throw new Error('The application runs a localize service other than the one of zibri.');
    }
    return service;
}

/**
 * Formats in a request asking for a locale.
 * @param acceptLanguage - The locale the request asks for.
 * @returns What it formatted.
 */
async function requestFormatted(acceptLanguage: string): Promise<Formatted> {
    const res: Response = await fetch(`${baseUrl}/formatted`, { headers: { [KnownHeader.ACCEPT_LANGUAGE]: acceptLanguage } });
    expect(res.status).toBe(200);
    return await res.json() as Formatted;
}

describe('running work in a locale', () => {
    beforeAll(async () => {
        await FsUtilities.createFile(FsUtilities.getPath(workDir, 'src', 'strings.ts'), ['export const welcome = () => $t`Welcome`;']);
        await generateSourceXlf(workDir, [{ origin: 'project', originLocale: 'en-US', patterns: `${workDir}/src/**/*.ts` }]);
        await FsUtilities.createFile(FsUtilities.getPath(translationsDir, 'de.xlf'), [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">',
            '  <file source-language="en-US" target-language="de" datatype="plaintext" original="project">',
            '    <body>',
            '      <trans-unit id="Welcome" xml:space="preserve">',
            '        <source>Welcome</source>',
            '        <target>Willkommen</target>',
            '      </trans-unit>',
            '    </body>',
            '  </file>',
            '</xliff>'
        ]);

        server = await startTestServer({
            dataSources: [dataSourceClass],
            controllers: [FormattedController],
            providers: [
                ...defaultTestServerProviders,
                // the repository's test servers skip the localize service's startup, which reads the translations
                defineProvider({ token: ZIBRI_DI_TOKENS.LOCALIZE_SERVICE, useClass: LocalizeService }),
                defineProvider({ token: ZIBRI_DI_TOKENS.TRANSLATIONS_PATH, useValue: translationsDir }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
                    useValue: { defaultLocale: 'en-US', supportedLocales: { 'en-US': english, de: german }, priceCurrency: 'defaultLocale' }
                })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(workDir);
    }, TestTimeouts.inMemory.shutdown);

    describe('outside a request, like a cron job', () => {
        it('translates and formats in the default locale', () => {
            expect($ts`Welcome`).toBe('Welcome');
            expect(localizeService().formatDate(DAY)).toBe('06/13/2026');
        });

        it('translates and formats in the locale it is run in, across an await', async () => {
            const formatted: string[] = await localizeService().runInLocale('de', async () => {
                const before: string = $ts`Welcome`;
                await new Promise(resolve => setTimeout(resolve, 5));
                return [before, $ts`Welcome`, localizeService().formatDate(DAY), $f.date(DAY)];
            });

            expect(formatted).toEqual(['Willkommen', 'Willkommen', '13.06.2026', '13.06.2026']);
            // and only inside it
            expect($ts`Welcome`).toBe('Welcome');
        });

        it('takes the locale of the innermost scope, and the outer one again once it returns', async () => {
            const formatted: string[] = await localizeService().runInLocale('de', async () => {
                const inner: string = await localizeService().runInLocale('en-US', async () => await Promise.resolve($ts`Welcome`));
                return [inner, $ts`Welcome`];
            });

            expect(formatted).toEqual(['Welcome', 'Willkommen']);
        });

        it('runs a locale of a supported language in that language', () => {
            expect(localizeService().runInLocale('de-AT', () => $ts`Welcome`)).toBe('Willkommen');
        });

        it('runs a locale the application does not support, and none, in the default locale', () => {
            expect(localizeService().runInLocale('fr', () => [$ts`Welcome`, localizeService().formatDate(DAY)]))
                .toEqual(['Welcome', '06/13/2026']);
            expect(localizeService().runInLocale(null, () => $ts`Welcome`)).toBe('Welcome');
            // inside another scope too, which a locale nobody chose does not carry on
            expect(localizeService().runInLocale('de', () => localizeService().runInLocale(undefined, () => $ts`Welcome`)))
                .toBe('Welcome');
        });
    });

    describe('formatting a price, with priceCurrency: \'defaultLocale\'', () => {
        it('keeps the currency of the default locale in every locale', () => {
            expect(localizeService().formatPrice(19.99, { locale: 'en-US' })).toBe('$19.99');
            expect(localizeService().formatPrice(19.99, { locale: 'de' })).toBe(`19,99${NBSP}$`);
            // in the locale of the scope, which is all the scope decides
            const inScope: string = localizeService().runInLocale(
                'de',
                () => localizeService().formatPrice(19.99, { locale: localizeService().resolveSupportedLocale(undefined) })
            );
            expect(inScope).toBe(`19,99${NBSP}$`);
        });

        it('keeps the currency it is given', () => {
            expect(localizeService().formatPrice(19.99, { locale: 'en-US', currency: 'EUR' })).toBe('€19.99');
            expect(localizeService().runInLocale('de', () => $f.price(19.99, 'EUR'))).toBe(`19,99${NBSP}€`);
        });
    });

    describe('in a request', () => {
        it('translates in the locale the request asks for, and keeps the currency of the default locale', async () => {
            const formatted: Formatted = await requestFormatted('de');

            expect(formatted).toMatchObject({ greeting: 'Willkommen', price: `19,99${NBSP}$`, priceInEuro: `19,99${NBSP}€` });
        });

        it('translates in the locale it is run in, and leaves the request the locale it asks for', async () => {
            const formatted: Formatted = await requestFormatted('de');

            expect(formatted.scoped).toEqual({ greeting: 'Welcome', price: '$19.99', requestLocale: 'de' });
            // read after the scope, from what was kept while it ran
            expect(formatted.greeting).toBe('Willkommen');
        });
    });
});