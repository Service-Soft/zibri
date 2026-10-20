import { beforeAll, describe, expect, it } from 'vitest';

import { generateXlf } from './generate-xlf.function.ts';
import { parseSourceXlf } from './parse-source-xlf.function.ts';
import { ExtractedTranslationString } from './transform-source-translation-tokens.function.ts';
import { initDiContainer } from '../../di/init-di-container.function.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';

beforeAll(() => {
    initDiContainer();
    // validation problems are translated, which needs an application that exists
    GlobalRegistry.markAppAsCreated();
});

describe('parseSourceXlf', () => {
    it('round-trips a single extracted string through generateXlf', async () => {
        const original: ExtractedTranslationString[] = [{ source: 'Hello {name}', sourceLocale: 'en', origin: 'zibri', file: 'src/a.ts', line: 3 }];

        const parsed: ExtractedTranslationString[] = await parseSourceXlf(generateXlf(original));

        expect(parsed).toEqual(original);
    });

    it('round-trips a string holding what xml reserves, as it was written', async () => {
        // the string is the id it is looked up by, so a character that comes back as its reference instead
        // - "&amp;" for "&" - is a string that is never found again, and is served untranslated
        const original: ExtractedTranslationString[] = [{ source: 'Tom & "Jerry" <3 {name}\'s', sourceLocale: 'en', origin: 'zibri', file: 'src/a.ts', line: 1 }];

        const parsed: ExtractedTranslationString[] = await parseSourceXlf(generateXlf(original));

        expect(parsed).toEqual(original);
    });

    it('round-trips multiple locations of the same source string as separate entries', async () => {
        const original: ExtractedTranslationString[] = [
            { source: 'Hello', sourceLocale: 'en', origin: 'zibri', file: 'src/a.ts', line: 1 },
            { source: 'Hello', sourceLocale: 'en', origin: 'zibri', file: 'src/b.ts', line: 5 }
        ];

        const parsed: ExtractedTranslationString[] = await parseSourceXlf(generateXlf(original));

        expect(parsed.sort((a, b) => a.file.localeCompare(b.file))).toEqual(
            [...original].sort((a, b) => a.file.localeCompare(b.file))
        );
    });

    it('round-trips multiple locales/origins as separate files', async () => {
        const original: ExtractedTranslationString[] = [
            { source: 'Hello', sourceLocale: 'en', origin: 'zibri', file: 'src/a.ts', line: 1 },
            { source: 'Hallo', sourceLocale: 'de', origin: 'project', file: 'src/b.ts', line: 2 }
        ];

        const parsed: ExtractedTranslationString[] = await parseSourceXlf(generateXlf(original));

        expect(parsed.sort((a, b) => a.source.localeCompare(b.source))).toEqual(
            [...original].sort((a, b) => a.source.localeCompare(b.source))
        );
    });

    it('reads a source file laid out the way it was written before, until the next build writes it again', async () => {
        // what a project has committed: indented inside its sources, which changes their text, and with an
        // encoding name that is not a registered one. The id is what a string is looked up by, so that is
        // what has to survive
        const xlf: string = [
            '<?xml version="1.0" encoding="utf8"?>',
            '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
            '  <file source-language="en-US" datatype="plaintext" original="project">',
            '    <body>',
            '      <trans-unit id="{days}d {hours}h" xml:space="preserve">',
            '        <source>',
            '          <x id="days" equiv-text="{days}"/>',
            '          d ',
            '          <x id="hours" equiv-text="{hours}"/>',
            '          h',
            '        </source>',
            '        <note>src/templates/pages/metrics/metrics-status.tsx:51</note>',
            '      </trans-unit>',
            '    </body>',
            '  </file>',
            '</xliff>'
        ].join('\n');

        const expected: ExtractedTranslationString = {
            source: '{days}d {hours}h',
            sourceLocale: 'en-US',
            origin: 'project',
            file: 'src/templates/pages/metrics/metrics-status.tsx',
            line: 51
        };
        expect(await parseSourceXlf(xlf)).toEqual([expected]);
    });

    it('returns an empty array for a document with no files', async () => {
        expect(await parseSourceXlf(generateXlf([]))).toEqual([]);
    });
});