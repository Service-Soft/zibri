import { describe, expect, it } from '@jest/globals';
import type { Content, ContextPageSize, DynamicContent, TDocumentDefinitions } from 'pdfmake/interfaces';

import { PdfFontFallbackContext, PdfFontFallbackUtilities, PdfGlyphCoverage } from './pdf-font-fallback.utilities';

/**
 * A font that draws exactly the given characters.
 * @param characters - The characters.
 * @returns What the font can draw.
 */
function drawing(characters: string): PdfGlyphCoverage {
    const codePoints: Set<number> = new Set([...characters].map(c => c.codePointAt(0) ?? 0));
    return { hasGlyphForCodePoint: codePoint => codePoints.has(codePoint) };
}

const LATIN: string = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:-';

const context: PdfFontFallbackContext = {
    coverage: new Map([
        ['Roboto', drawing(LATIN)],
        ['Serif', drawing(LATIN)],
        ['Cjk', drawing('山田太郎 ')],
        ['Hebrew', drawing('שלום')],
        ['Everything', drawing(`${LATIN}山田太郎שלום`)]
    ]),
    fallbacks: ['Cjk', 'Hebrew', 'Everything'],
    styles: undefined
};

/**
 * Applies the fallbacks to a document of the given content.
 * @param content - The content.
 * @param definition - The rest of the document.
 * @returns The content afterwards.
 */
function apply(content: Content, definition: Partial<TDocumentDefinitions> = {}): Content {
    return PdfFontFallbackUtilities.apply({ ...definition, content }, context).content;
}

describe('PdfFontFallbackUtilities', () => {

    it('leaves a text its own font draws alone, the same object', () => {
        const content: Content = [{ text: 'Invoice 42', bold: true }, 'Due date: 2026-11-30'];
        const definition: TDocumentDefinitions = { content };

        expect(PdfFontFallbackUtilities.apply(definition, context).content).toEqual(content);
    });

    it('sets the characters the font lacks in the first fallback that draws them', () => {
        expect(apply('Invoice for 山田太郎')).toEqual({ text: ['Invoice for ', { text: '山田太郎', font: 'Cjk' }] });
    });

    it('keeps the spaces inside a name in the run of the name', () => {
        expect(apply('Dear 山田 太郎, thanks')).toEqual({ text: ['Dear ', { text: '山田 太郎', font: 'Cjk' }, ', thanks'] });
    });

    it('takes the fallbacks in their order, and skips one that lacks the character', () => {
        expect(apply('שלום 山田')).toEqual({ text: [{ text: 'שלום ', font: 'Hebrew' }, { text: '山田', font: 'Cjk' }] });
    });

    it('leaves a character no font draws in the text\'s own font', () => {
        expect(apply('Price €')).toEqual('Price €');
    });

    it('keeps everything else an element says, such as bold and its margin', () => {
        expect(apply({ text: 'To 山田', bold: true, margin: [0, 10, 0, 0] })).toEqual({
            text: { text: ['To ', { text: '山田', font: 'Cjk' }] },
            bold: true,
            margin: [0, 10, 0, 0]
        });
    });

    it('reads the font of a text from the element, its style, the element around it and the document', () => {
        const everything: Partial<TDocumentDefinitions> = {
            defaultStyle: { font: 'Everything' },
            styles: { serif: { font: 'Serif' } }
        };

        // the document's font draws all of it
        expect(apply('Für 山田', everything)).toEqual('Für 山田');
        // the element names one that does not
        expect(apply({ text: 'To 山田', font: 'Serif' }, everything)).toEqual({ text: { text: ['To ', { text: '山田', font: 'Cjk' }] }, font: 'Serif' });
        // so does its style, and the element around it hands its own down
        expect(apply({ stack: ['To 山田'], style: 'serif' }, everything)).toEqual({ stack: [{ text: ['To ', { text: '山田', font: 'Cjk' }] }], style: 'serif' });
        // the last style naming a font wins, as in pdfmake
        expect(apply({ text: 'To 山田', style: ['serif', { font: 'Everything' }] }, everything)).toEqual({ text: 'To 山田', style: ['serif', { font: 'Everything' }] });
    });

    it('reaches every text: stacks, columns, lists, tables and inline runs', () => {
        const name: Content = { text: ['To ', { text: '山田', font: 'Cjk' }] };

        expect(apply([
            { columns: [{ text: 'To 山田', width: 100 }, 'To 山田'] },
            { ul: ['To 山田'] },
            { ol: [{ text: 'To 山田', counter: 3 }] },
            { table: { widths: ['*', 50], body: [[{ text: 'To 山田', colSpan: 2 }, {}], ['To 山田', 'Total']] } },
            { text: ['To ', { text: '山田', bold: true }] }
        ])).toEqual([
            { columns: [{ text: name, width: 100 }, name] },
            { ul: [name] },
            { ol: [{ text: name, counter: 3 }] },
            { table: { widths: ['*', 50], body: [[{ text: name, colSpan: 2 }, {}], [name, 'Total']] } },
            { text: ['To ', { text: { text: [{ text: '山田', font: 'Cjk' }] }, bold: true }] }
        ]);
    });

    it('applies to the header and the footer, also when they are made per page', () => {
        const pageSize: ContextPageSize = { width: 595, height: 842, orientation: 'portrait' };
        const footer: DynamicContent = page => `Page ${page} 山田`;

        const applied: TDocumentDefinitions = PdfFontFallbackUtilities.apply({ content: [], header: 'From 山田', footer }, context);

        expect(applied.header).toEqual({ text: ['From ', { text: '山田', font: 'Cjk' }] });
        expect(typeof applied.footer === 'function' ? applied.footer(2, 3, pageSize) : undefined)
            .toEqual({ text: ['Page 2 ', { text: '山田', font: 'Cjk' }] });
    });
});