import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { defineDateFormat } from './define-date-format.function';
import { LocalizeService } from './localize.service';
import { LocaleConfiguration } from './models/localize-options.model';
import { $t, $ts } from './translate.function';
import { generateSourceXlf } from './xlf/generate-source-xlf.function';
import { TestTimeouts, testFileFolder } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider } from '../di/models/di-provider.model';
import { Logger } from '../logging/logger';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

/**
 * A translation goes the whole way: the build writes source.xlf from the code, a translator copies
 * it into de.xlf and fills every target, and the running application finds that target for the
 * string the code builds at runtime. The ids source.xlf has are the ones `$t` looks up, or nothing
 * a translator writes is ever found.
 */

const workDir: FsPath = FsUtilities.getPath(testFileFolder, 'translation-round-trip');
const translationsDir: FsPath = FsUtilities.getPath(workDir, 'translations');

const locale: LocaleConfiguration = {
    currencyCode: 'EUR',
    defaultDateFormat: defineDateFormat('DD.MM.YYYY'),
    defaultDateTimeFormat: defineDateFormat('DD.MM.YYYY HH:mm'),
    defaultTimeFormat: defineDateFormat('HH:mm')
};

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

let baseUrl: string;

@Controller('/greeting')
class GreetingController {
    @Get()
    greet(): { greeting: string } {
        const name: string = 'Ada';
        return { greeting: $ts`Hello ${name}` };
    }
}

async function readSourceIds(): Promise<string[]> {
    const source: string = await FsUtilities.readFile(FsUtilities.getPath(translationsDir, 'source.xlf'));
    return [...source.matchAll(/<trans-unit id="([^"]*)"/g)].map(match => match[1] ?? '');
}

async function writeGermanFromSource(): Promise<void> {
    // what a translator does: copy source.xlf, name the target language and fill in every target
    const source: string = await FsUtilities.readFile(FsUtilities.getPath(translationsDir, 'source.xlf'));
    const german: string = source
        .replace('source-language="en-US"', 'source-language="en-US" target-language="de"')
        .replaceAll(
            /<trans-unit id="([^"]*)"[^>]*>\n(\s*)<source>.*<\/source>/g,
            (unit: string, id: string, indent: string) => `${unit}\n${indent}<target>${
                // the placeholder of the last one misspelled, which leaves it out
                id.replace('Hello', 'Hallo').replace('Welcome {firstName}', 'Willkommen {fistName}')
            }</target>`
        );
    await FsUtilities.createFile(FsUtilities.getPath(translationsDir, 'de.xlf'), german);
}

describe('a translation, from the code through source.xlf and de.xlf to the running application', () => {
    // on the class rather than on an instance: the translations are read while the application
    // starts, before a test can reach the logger it starts with
    const warn: jest.SpiedFunction<Logger['warn']> = jest.spyOn(Logger.prototype, 'warn');

    beforeAll(async () => {
        await FsUtilities.createFile(FsUtilities.getPath(workDir, 'src', 'greeting.ts'), [
            'export const plain = (name: string) => $t`Hello ${name}`;',
            'export const named = (user: { firstName: string }) => $t`Hello ${{ firstName: user.firstName }}`;',
            'export const welcome = (user: { firstName: string }) => $t`Welcome ${{ firstName: user.firstName }}`;'
        ]);
        await generateSourceXlf(workDir, [{ origin: 'project', originLocale: 'en-US', patterns: `${workDir}/src/**/*.ts` }]);
        await writeGermanFromSource();

        server = await startTestServer({
            controllers: [GreetingController],
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                // the repository's test servers skip the localize service's startup, and this suite
                // is about exactly that startup
                defineProvider({ token: ZIBRI_DI_TOKENS.LOCALIZE_SERVICE, useClass: LocalizeService }),
                defineProvider({ token: ZIBRI_DI_TOKENS.TRANSLATIONS_PATH, useValue: translationsDir }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
                    useValue: { supportedLocales: { 'en-US': locale, de: locale } }
                })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        warn.mockRestore();
        await server?.shutdown();
        await FsUtilities.rm(workDir);
    }, TestTimeouts.inMemory.shutdown);

    it('writes the ids $t looks up: numbered placeholders, or the key of an inline object', async () => {
        expect(await readSourceIds()).toEqual(['Hello {$1}', 'Hello {firstName}', 'Welcome {firstName}']);
    });

    it('is a translation the translator keys by those ids', async () => {
        const german: string = await FsUtilities.readFile(FsUtilities.getPath(translationsDir, 'de.xlf'));

        expect(german).toContain('<target>Hallo {$1}</target>');
        expect(german).toContain('<target>Hallo {firstName}</target>');
    });

    it('reads the translations of every supported locale at boot', () => {
        expect(server?.bootLog.join('\n')).toContain('  - en-US\n  - de');
    });

    it('finds the target a translator wrote for a string with a placeholder', () => {
        const name: string = 'Ada';

        expect($t`Hello ${name}`.getValue('de')).toBe('Hallo Ada');
    });

    it('finds the target for a placeholder named by an inline object', () => {
        const user: { firstName: string } = { firstName: 'Ada' };

        expect($t`Hello ${{ firstName: user.firstName }}`.getValue('de')).toBe('Hallo Ada');
    });

    // a placeholder the translator misspelled or left out was served as the text
    // around it, and nothing said so
    it('warns at boot about a translation that leaves out a placeholder of its source', () => {
        expect(warn).toHaveBeenCalledWith('The "de" translation of "Welcome {firstName}" leaves out {firstName} (src/greeting.ts:3)');
        // a translation keeping every placeholder, in another order or not, is said nothing about
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('translation of "Hello'));
    });

    it('serves a brace the translator wrote that names no placeholder of the source as written', () => {
        expect($t`Welcome ${{ firstName: 'Ada' }}`.getValue('de')).toBe('Willkommen {fistName}');
    });

    it.each([
        ['names its locale twice', '?locale=de&locale=en-US'],
        ['names an empty locale', '?locale='],
        ['names a locale the application does not support', '?locale=fr']
    ])('answers a request that %s in the language of its header', async (_how, query) => {
        const response: Response = await fetch(`${baseUrl}/greeting${query}`, { headers: { 'accept-language': 'de' } });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ greeting: 'Hallo Ada' });
    });
});