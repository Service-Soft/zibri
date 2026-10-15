import { describe, expect, it } from '@jest/globals';

import { PdfDocument, PdfUtilities } from './pdf.utilities';

/**
 * Reads a created document to its end.
 * @param doc - The document.
 * @returns The bytes of the pdf, as latin1 text.
 */
async function render(doc: PdfDocument): Promise<string> {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const ended: Promise<void> = new Promise(resolve => doc.on('end', resolve));
    doc.end();
    await ended;
    return Buffer.concat(chunks).toString('latin1');
}

describe('PdfUtilities', () => {
    it('sets bold and italic text in fonts of their own', async () => {
        const pdf: string = await render(PdfUtilities.create(
            {
                content: [
                    'regular',
                    { text: 'bold', bold: true },
                    { text: 'italic', italics: true },
                    { text: 'bold italic', bold: true, italics: true }
                ],
                attachments: []
            },
            undefined
        ));

        // the name of every embedded font, without the tag that marks it as a subset. Each one is
        // named twice, by the font and by the font it descends from
        const fonts: Set<string> = new Set([...pdf.matchAll(/\/BaseFont \/(?:[A-Z]{6}\+)?([\w-]+)/g)].map(match => match[1] ?? ''));
        expect([...fonts].sort()).toStrictEqual(['Roboto-Italic', 'Roboto-Medium', 'Roboto-MediumItalic', 'Roboto-Regular']);
    });
});