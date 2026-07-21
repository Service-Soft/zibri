import { describe, expect, it } from '@jest/globals';

import { generateXlf } from './generate-xlf.function';
import { ExtractedTranslationString } from './transform-source-translation-tokens.function';

function entry(overrides: Partial<ExtractedTranslationString> = {}): ExtractedTranslationString {
    return {
        source: 'Hello',
        sourceLocale: 'en',
        origin: 'zibri',
        file: 'src/a.ts',
        line: 1,
        ...overrides
    };
}

describe('generateXlf', () => {
    it('generates a valid xliff document with the given source string', () => {
        const xlf: string = generateXlf([entry()]);

        expect(xlf).toContain('<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">');
        expect(xlf).toContain('<file source-language="en" datatype="plaintext" original="zibri">');
        expect(xlf).toContain('<trans-unit id="Hello" xml:space="preserve">');
        expect(xlf).toContain('<source>Hello</source>');
        expect(xlf).toContain('<note>src/a.ts:1</note>');
    });

    it('groups multiple occurrences of the same source string into one trans-unit with combined locations', () => {
        const xlf: string = generateXlf([
            entry({ file: 'src/a.ts', line: 1 }),
            entry({ file: 'src/b.ts', line: 5 })
        ]);

        expect(xlf.match(/<trans-unit/g)?.length).toBe(1);
        expect(xlf).toContain('<note>src/a.ts:1, src/b.ts:5</note>');
    });

    it('groups by sourceLocale + origin into separate <file> elements', () => {
        const xlf: string = generateXlf([
            entry({ sourceLocale: 'en', origin: 'zibri' }),
            entry({ sourceLocale: 'de', origin: 'zibri' })
        ]);

        expect(xlf.match(/<file/g)?.length).toBe(2);
        expect(xlf).toContain('source-language="de"');
        expect(xlf).toContain('source-language="en"');
    });

    it('converts {placeholder} tokens into <x> elements', () => {
        const xlf: string = generateXlf([entry({ source: 'Hello {name}!' })]);

        expect(xlf).toContain('<x id="name" equiv-text="{name}"/>');
        expect(xlf).toMatch(/Hello/);
        expect(xlf).toMatch(/!/);
    });

    it('unescapes doubled braces {{ and }} into literal braces', () => {
        const xlf: string = generateXlf([entry({ source: 'literal {{brace}}' })]);

        expect(xlf).toContain('literal {brace}');
        expect(xlf).not.toContain('<x id="brace"');
    });

    it('sorts trans-units by source string within a file', () => {
        const xlf: string = generateXlf([
            entry({ source: 'Zebra' }),
            entry({ source: 'Apple' })
        ]);

        const appleIndex: number = xlf.indexOf('id="Apple"');
        const zebraIndex: number = xlf.indexOf('id="Zebra"');
        expect(appleIndex).toBeGreaterThan(-1);
        expect(appleIndex).toBeLessThan(zebraIndex);
    });

    it('produces an empty xliff document for no strings', () => {
        const xlf: string = generateXlf([]);
        expect(xlf).toContain('<xliff');
        expect(xlf).not.toContain('<file');
    });
});