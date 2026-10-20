import { describe, expect, it } from 'vitest';

import { generateXlf } from './generate-xlf.function.ts';
import { ExtractedTranslationString } from './transform-source-translation-tokens.function.ts';

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

// no application and no di container, which is how a build runs it
describe('generateXlf', () => {
    it('generates a valid xliff document with the given source string', () => {
        const xlf: string = generateXlf([entry()]);

        expect(xlf).toContain('<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">');
        expect(xlf).toContain('<file source-language="en" datatype="plaintext" original="zibri">');
        expect(xlf).toContain('<trans-unit id="Hello" xml:space="preserve">');
        expect(xlf).toContain('<source>Hello</source>');
        expect(xlf).toContain('<note>src/a.ts:1</note>');
    });

    it('lays the elements out on lines of their own, and leaves the text of a source exactly as it is', () => {
        const xlf: string = generateXlf([entry({ source: '{days}d {hours}h' })]);

        // every trans-unit says xml:space="preserve", so a translator's tool reads each space inside a
        // source as part of it - indenting there would change the string that is translated
        expect(xlf).toContain([
            '      <trans-unit id="{days}d {hours}h" xml:space="preserve">',
            '        <source><x id="days" equiv-text="{days}"/>d <x id="hours" equiv-text="{hours}"/>h</source>',
            '        <note>src/a.ts:1</note>',
            '      </trans-unit>'
        ].join('\n'));
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

        expect(xlf).toContain('<source>Hello <x id="name" equiv-text="{name}"/>!</source>');
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