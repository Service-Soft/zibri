import { describe, expect, it } from '@jest/globals';

import { generateXlf } from './generate-xlf.function';
import { parseSourceXlf } from './parse-source-xlf.function';
import { ExtractedTranslationString } from './transform-source-translation-tokens.function';

describe('parseSourceXlf', () => {
    it('round-trips a single extracted string through generateXlf', () => {
        const original: ExtractedTranslationString[] = [{ source: 'Hello {name}', sourceLocale: 'en', origin: 'zibri', file: 'src/a.ts', line: 3 }];

        const xlf: string = generateXlf(original);
        const parsed: ExtractedTranslationString[] = parseSourceXlf(xlf);

        expect(parsed).toEqual(original);
    });

    it('round-trips multiple locations of the same source string as separate entries', () => {
        const original: ExtractedTranslationString[] = [
            { source: 'Hello', sourceLocale: 'en', origin: 'zibri', file: 'src/a.ts', line: 1 },
            { source: 'Hello', sourceLocale: 'en', origin: 'zibri', file: 'src/b.ts', line: 5 }
        ];

        const xlf: string = generateXlf(original);
        const parsed: ExtractedTranslationString[] = parseSourceXlf(xlf);

        expect(parsed.sort((a, b) => a.file.localeCompare(b.file))).toEqual(
            [...original].sort((a, b) => a.file.localeCompare(b.file))
        );
    });

    it('round-trips multiple locales/origins as separate files', () => {
        const original: ExtractedTranslationString[] = [
            { source: 'Hello', sourceLocale: 'en', origin: 'zibri', file: 'src/a.ts', line: 1 },
            { source: 'Hallo', sourceLocale: 'de', origin: 'project', file: 'src/b.ts', line: 2 }
        ];

        const xlf: string = generateXlf(original);
        const parsed: ExtractedTranslationString[] = parseSourceXlf(xlf);

        expect(parsed.sort((a, b) => a.source.localeCompare(b.source))).toEqual(
            [...original].sort((a, b) => a.source.localeCompare(b.source))
        );
    });

    it('returns an empty array for a document with no files', () => {
        const xlf: string = generateXlf([]);
        expect(parseSourceXlf(xlf)).toEqual([]);
    });
});