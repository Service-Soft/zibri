import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts, testFileFolder } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider } from '../di/models/di-provider.model';
import { Logger } from '../logging/logger';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { defineDateFormat } from './define-date-format.function';
import { LocalizeService } from './localize.service';
import { LocaleConfiguration } from './models/localize-options.model';
import { $t } from './translate.function';
import { generateSourceXlf } from './xlf/generate-source-xlf.function';

/**
 * The framework ships the German of its own strings, named in the "translations" of its
 * package.json, and an application that supports German serves them without translating them
 * itself. A string the application translates in its own file is served the way it translated it.
 */

const workDir: FsPath = FsUtilities.getPath(testFileFolder, 'shipped-translations');
const translationsDir: FsPath = FsUtilities.getPath(workDir, 'translations');
// a package of zibri, of which only what the localization reads
const zibriRoot: FsPath = FsUtilities.getPath(workDir, 'zibri');

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

function xliff(units: [string, string][], targetLanguage: string): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">',
        `  <file source-language="en-US" target-language="${targetLanguage}" datatype="plaintext" original="zibri">`,
        '    <body>',
        ...units.map(([source, target]) => [
            `      <trans-unit id="${source}" xml:space="preserve">`,
            `        <source>${source}</source>`,
            `        <target>${target}</target>`,
            '      </trans-unit>'
        ].join('\n')),
        '    </body>',
        '  </file>',
        '</xliff>'
    ].join('\n');
}

let server: StartedTestServer | undefined;

describe('the translation zibri ships of its own strings', () => {
    const warn: jest.SpiedFunction<Logger['warn']> = jest.spyOn(Logger.prototype, 'warn');

    beforeAll(async () => {
        // the strings of the framework and the one of the application, as the build of the application finds them
        await FsUtilities.createFile(FsUtilities.getPath(workDir, 'src', 'strings.ts'), [
            'export const required = (name: string) => $t`${name} is required.`;',
            'export const invalid = () => $t`The token is invalid.`;',
            'export const welcome = () => $t`Welcome`;'
        ]);
        await generateSourceXlf(workDir, [{ origin: 'project', originLocale: 'en-US', patterns: `${workDir}/src/**/*.ts` }]);

        await FsUtilities.createFile(FsUtilities.getPath(zibriRoot, 'package.json'), JSON.stringify({
            name: 'zibri',
            translations: { de: './translations/de.xlf' }
        }));
        await FsUtilities.createFile(FsUtilities.getPath(zibriRoot, 'translations', 'de.xlf'), xliff([
            ['{$1} is required.', '{$1} ist erforderlich.'],
            ['The token is invalid.', 'Das Token ist ungültig.']
        ], 'de'));
        // the application says it its own way, for its locale of a region
        await FsUtilities.createFile(FsUtilities.getPath(translationsDir, 'de-AT.xlf'), xliff([
            ['The token is invalid.', 'Der Token ist ungültig.'],
            ['Welcome', 'Servus']
        ], 'de-AT'));

        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                // the repository's test servers skip the localize service's startup, and this suite
                // is about exactly that startup
                defineProvider({ token: ZIBRI_DI_TOKENS.LOCALIZE_SERVICE, useClass: LocalizeService }),
                defineProvider({ token: ZIBRI_DI_TOKENS.TRANSLATIONS_PATH, useValue: translationsDir }),
                defineProvider({ token: ZIBRI_DI_TOKENS.ZIBRI_PACKAGE_ROOT, useValue: zibriRoot }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
                    useValue: { supportedLocales: { 'en-US': locale, 'de-AT': locale } }
                })
            ]
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        warn.mockRestore();
        await server?.shutdown();
        await FsUtilities.rm(workDir);
    }, TestTimeouts.inMemory.shutdown);

    it('serves the German of zibri for a locale of the language, which the application does not translate', () => {
        const name: string = 'E-Mail';

        expect($t`${name} is required.`.getValue('de-AT')).toBe('E-Mail ist erforderlich.');
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Missing translation of "{$1} is required."'));
    });

    it('serves the translation of the application where it has one of the same string', () => {
        expect($t`The token is invalid.`.getValue('de-AT')).toBe('Der Token ist ungültig.');
        expect($t`Welcome`.getValue('de-AT')).toBe('Servus');
    });

    it('leaves a locale zibri ships nothing for as it was written', () => {
        expect($t`The token is invalid.`.getValue('en-US')).toBe('The token is invalid.');
    });
});