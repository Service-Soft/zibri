import { writeFile } from 'node:fs/promises';

import { afterAll, beforeAll, expect, it } from '@jest/globals';

import { testFileFolder } from '../__testing__/constants';
import { createFakeFont } from '../__testing__/fake-font.function';
import { PdfmakeTestUtilities } from '../__testing__/pdfmake-test.utilities';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { PdfFontOptions } from './pdf-font-options.model';
import { PdfDocument, PdfDocumentDefinition, PdfUtilities } from './pdf.utilities';

/**
 * A font for Japanese names, with the characters of one and nothing else.
 */
const CJK_FONT: Buffer = createFakeFont('FakeCjkSans', '山田太郎');

/**
 * A font for the brand of an invoice, with every Latin character it uses.
 */
const BRAND_FONT: Buffer = createFakeFont('FakeBrand', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:');

/**
 * Writes a pdf in full.
 * @param doc - The pdf.
 * @returns Its bytes, as latin1 text, where the names of the fonts it embeds can be read.
 */
async function bytesOf(doc: PdfDocument): Promise<string> {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const ended: Promise<void> = new Promise<void>(resolve => doc.on('end', () => resolve()));
    doc.end();
    await ended;
    return Buffer.concat(chunks).toString('latin1');
}

/**
 * The fonts a pdf embeds, by the name it gives them, without the tag of the subset.
 * @param pdf - The pdf's bytes.
 * @returns The names.
 */
function embeddedFontsOf(pdf: string): string[] {
    return [...new Set([...pdf.matchAll(/\/BaseFont \/[A-Z]{6}\+([\w-]+)/g)].map(match => match[1] ?? ''))].sort();
}

const definition: PdfDocumentDefinition = { attachments: [], content: ['Invoice for 山田太郎'] };

PdfmakeTestUtilities.describeOnEvery('the fonts of a pdf', () => {
    const folder: FsPath = FsUtilities.getPath(testFileFolder, `pdf-fonts-${UUIDUtilities.generate()}`);
    const brandFile: FsPath = FsUtilities.getPath(folder, 'FakeBrand.ttf');

    beforeAll(async () => {
        await FsUtilities.mkdir(folder);
        await writeFile(brandFile, BRAND_FONT);
    });

    afterAll(async () => {
        await FsUtilities.rm(folder);
    });

    it('set a character its font lacks in the fallback that has it', async () => {
        const fonts: PdfFontOptions = { families: { Cjk: { normal: CJK_FONT } }, fallbacks: ['Cjk'] };

        const pdf: string = await bytesOf(await PdfUtilities.resolve(definition, undefined, fonts));

        expect(embeddedFontsOf(pdf)).toEqual(['FakeCjkSans', 'Roboto-Regular']);
    });

    it('leave the characters blank in Roboto when no fallback is named', async () => {
        const fonts: PdfFontOptions = { families: { Cjk: { normal: CJK_FONT } }, fallbacks: [] };

        const pdf: string = await bytesOf(await PdfUtilities.resolve(definition, undefined, fonts));

        expect(embeddedFontsOf(pdf)).toEqual(['Roboto-Regular']);
    });

    it('set a document in a registered family, bold included when the family has normal alone', async () => {
        const fonts: PdfFontOptions = { families: { Brand: { normal: BRAND_FONT }, Cjk: { normal: CJK_FONT } }, fallbacks: ['Cjk'] };
        const branded: PdfDocumentDefinition = {
            attachments: [],
            defaultStyle: { font: 'Brand' },
            content: [{ text: 'Invoice 42', bold: true }, 'For 山田太郎']
        };

        const pdf: string = await bytesOf(await PdfUtilities.resolve(branded, undefined, fonts));

        expect(embeddedFontsOf(pdf)).toEqual(['FakeBrand', 'FakeCjkSans']);
    });

    // the fonts are the application's, so reading them is not something the access options of a pdf decide
    it('set a document in a family given by the path of its file, with no folder allowed', async () => {
        const fonts: PdfFontOptions = { families: { Brand: { normal: brandFile } }, fallbacks: [] };
        const branded: PdfDocumentDefinition = { attachments: [], defaultStyle: { font: 'Brand' }, content: ['Invoice 42'] };

        const pdf: string = await bytesOf(await PdfUtilities.resolve(branded, undefined, fonts, { allowedFolders: [] }));

        expect(embeddedFontsOf(pdf)).toEqual(['FakeBrand']);
    });

    it('refuse a fallback that names no registered family', async () => {
        const fonts: PdfFontOptions = { families: {}, fallbacks: ['Cjk'] };

        await expect(PdfUtilities.resolve(definition, undefined, fonts)).rejects.toThrow(/Cjk/);
    });
});