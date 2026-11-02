import { readFileSync } from 'node:fs';

import type PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions, Column, Content, Size, ImageDefinition, BufferOptions, PageSize } from 'pdfmake/interfaces';

import { PdfFontFallbackUtilities, PdfGlyphCoverage } from './pdf-font-fallback.utilities';
import { PdfFontFamily, PdfFontFile, PdfFontOptions } from './pdf-font-options.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getAllRegisteredTokens } from '../di/get-all-registered-tokens.function';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { FsPath } from '../utilities/fs.utilities';
import { optionalPeer, optionalPeerDependency } from '../utilities/optional-peer.function';

/**
 * Complete definition of a PDF document.
 */
export type PdfDocumentDefinition = TDocumentDefinitions & {
    /**
     * Attachments of the pdf file.
     */
    attachments: PdfAttachmentDefinition[]
};
/**
 * Definition for an attachment of a pdf file.
 */
export type PdfAttachmentDefinition = {
    /**
     * The file content of the attachment, or the path of the file it is read from.
     */
    src: FsPath | ArrayBuffer | Buffer<ArrayBufferLike>,
    /**
     * Metadata about the attachment.
     */
    options: PDFKit.Mixins.PDFAttachmentOptions
        & Required<Pick<PDFKit.Mixins.PDFAttachmentOptions, 'name'>>
};
/**
 * Definition of an image to be embedded into the document.
 */
export type PdfImageDefinition = ImageDefinition;
/**
 * Common type for all available pdf content elements.
 */
export type PdfContentDefinition = Content;
/**
 * Sizes for the width of stand-alone columns and table columns.
 *
 * Available options are:
 * - A number to define an absolute width in `pt`
 * - A percentage string such as `50%` to fill a portion of the available space
 * - `auto` to set the width based on the content
 * - `*` to fill the remaining available space, distributed equally among
 * all star-sized columns.
 */
export type PdfContentSize = Size;
/**
 * The size of the pages of a pdf: a standard size such as `'A4'` or `'LETTER'`, or a width and a
 * height in `pt`.
 */
export type PdfPageSize = PageSize;
/**
 * Definition of a pdf column.
 */
export type PdfColumnDefinition = Column;
/**
 * Definition of a pdf table cell.
 */
export type PdfTableCellDefinition = Content;
/**
 * Options regarding buffer handling.
 */
export type PdfBufferOptions = BufferOptions;

/**
 * A created pdf document.
 */
export type PdfDocument = PDFKit.PDFDocument;

/**
 * What fontkit is used for: reading which characters a font can draw.
 */
type Fontkit = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    create: (buffer: Buffer) => Partial<PdfGlyphCoverage>
};

/**
 * A printer, and what each of its families can draw.
 */
type PdfFontSetup = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    printer: PdfPrinter,
    // eslint-disable-next-line jsdoc/require-jsdoc
    coverage: ReadonlyMap<string, PdfGlyphCoverage>
};

/**
 * The fonts of a pdf made outside an application: Roboto, and nothing to stand in for it. One object,
 * so that every such pdf shares one printer.
 */
const ROBOTO_ALONE: PdfFontOptions = { families: {}, fallbacks: [] };

/**
 * The font descriptors a pdfmake printer is built with.
 */
type PdfKitFontDescriptors = Record<string, Record<'normal' | 'bold' | 'italics' | 'bolditalics', PdfFontFile>>;

/**
 * Provides functionality around dealing with pdf files.
 */
export abstract class PdfUtilities {
    /**
     * A printer for each set of fonts, so that each application makes its pdfs with its own and a
     * printer goes with the options it was built from.
     */
    private static readonly setups: WeakMap<PdfFontOptions, PdfFontSetup> = new WeakMap();

    /**
     * Creates a pdf from the provided definition.
     *
     * Each character of a text the font of the text cannot draw is set in the first of the
     * `fallbacks` of the fonts that can.
     * @param documentDefinition - The definition to create the pdf from.
     * @param options - Additional options regarding the buffer.
     * @param fonts - The fonts the pdf may be set in. The application's, from `ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS`,
     * by default, and Roboto alone outside an application.
     * @returns A readable of the newly created pdf.
     */
    static create(
        documentDefinition: PdfDocumentDefinition,
        options: PdfBufferOptions | undefined,
        fonts: PdfFontOptions = this.resolveFontOptions()
    ): PdfDocument {
        const setup: PdfFontSetup = this.resolveSetup(fonts);
        // nothing to look at when nothing stands in, which is every application that registered no fallback
        const definition: PdfDocumentDefinition = fonts.fallbacks.length === 0
            ? documentDefinition
            : PdfFontFallbackUtilities.apply(documentDefinition, {
                coverage: setup.coverage,
                fallbacks: fonts.fallbacks,
                styles: undefined
            });
        const doc: PdfDocument = setup.printer.createPdfKitDocument(definition, options);
        for (const attachment of documentDefinition.attachments) {
            doc.file(attachment.src, attachment.options);
        }
        return doc;
    }

    /**
     * The fonts of the running application.
     * @returns Its fonts, or none besides Roboto when no application has registered any, such as in a script.
     */
    private static resolveFontOptions(): PdfFontOptions {
        return getAllRegisteredTokens().includes(ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS)
            ? inject(ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS)
            : ROBOTO_ALONE;
    }

    /**
     * The printer for a set of fonts, built the first time a document is made with them.
     *
     * Not built when this class is evaluated, which is when the barrel that re-exports it is loaded,
     * so an application that never makes a pdf would still need the optional peer dependency behind
     * it. Kept afterwards because it holds the fonts it read.
     * @param fonts - The fonts.
     * @returns The printer, and what each family can draw.
     * @throws InternalError when a fallback names a family that is not registered.
     */
    private static resolveSetup(fonts: PdfFontOptions): PdfFontSetup {
        const existing: PdfFontSetup | undefined = this.setups.get(fonts);
        if (existing != undefined) {
            return existing;
        }
        // the module is the constructor - pdfmake sets `module.exports` to it, so there is no
        // `default` to reach through the way an esm style import would suggest
        const Printer: typeof PdfPrinter = optionalPeer<typeof PdfPrinter>('pdfmake', 'Creating a pdf');
        // the static cuts of Roboto that pdfmake ships with its browser build, base64 by file name.
        // Static ones, because pdfkit draws a variable font at its default weight only, so bold text
        // set in one comes out regular
        const shipped: Record<string, string> = optionalPeer<Record<string, string>>('pdfmake/build/vfs_fonts', 'Creating a pdf');
        const families: Record<string, PdfFontFamily> = {
            Roboto: {
                normal: this.resolveShippedFont(shipped, 'Roboto-Regular.ttf'),
                bold: this.resolveShippedFont(shipped, 'Roboto-Medium.ttf'),
                italics: this.resolveShippedFont(shipped, 'Roboto-Italic.ttf'),
                bolditalics: this.resolveShippedFont(shipped, 'Roboto-MediumItalic.ttf')
            },
            ...fonts.families
        };
        const unknown: string[] = fonts.fallbacks.filter(name => families[name] == undefined);
        if (unknown.length > 0) {
            throw new InternalError(`The pdf font fallbacks name families that are not registered: ${unknown.join(', ')}.`);
        }

        const descriptors: PdfKitFontDescriptors = {};
        for (const [name, family] of Object.entries(families)) {
            descriptors[name] = {
                normal: family.normal,
                bold: family.bold ?? family.normal,
                italics: family.italics ?? family.normal,
                bolditalics: family.bolditalics ?? family.bold ?? family.italics ?? family.normal
            };
        }
        const setup: PdfFontSetup = {
            printer: new Printer(descriptors),
            // only what the fallbacks need: which characters each family can draw is read when a
            // text is looked at, and nothing is looked at without fallbacks
            coverage: fonts.fallbacks.length === 0 ? new Map() : this.resolveCoverage(families)
        };
        this.setups.set(fonts, setup);
        return setup;
    }

    /**
     * Reads which characters each family can draw, from its `normal` file.
     * @param families - The families.
     * @returns What each can draw, by its name.
     * @throws InternalError when a file is a collection of fonts, such as a `.ttc` file.
     */
    private static resolveCoverage(families: Record<string, PdfFontFamily>): ReadonlyMap<string, PdfGlyphCoverage> {
        // the fontkit pdfmake draws with, so the characters a family is said to have are the ones it draws
        const fontkit: Fontkit = optionalPeerDependency<Fontkit>(
            ['pdfmake', '@foliojs-fork/pdfkit'],
            '@foliojs-fork/fontkit',
            'Font fallbacks in a pdf'
        );
        const coverage: Map<string, PdfGlyphCoverage> = new Map();
        for (const [name, family] of Object.entries(families)) {
            const file: PdfFontFile = family.normal;
            const font: Partial<PdfGlyphCoverage> = fontkit.create(Buffer.isBuffer(file) ? file : readFileSync(file));
            const hasGlyphForCodePoint: ((codePoint: number) => boolean) | undefined = font.hasGlyphForCodePoint?.bind(font);
            if (hasGlyphForCodePoint == undefined) {
                throw new InternalError(
                    `The pdf font family "${name}" is a collection of fonts. Give it the file of one font, such as an .otf or .ttf file.`
                );
            }
            coverage.set(name, { hasGlyphForCodePoint });
        }
        return coverage;
    }

    /**
     * Reads one of the fonts pdfmake ships.
     * @param fonts - The fonts, base64 by file name.
     * @param file - The file name of the font.
     * @returns The font.
     * @throws InternalError when the installed pdfmake does not ship the font.
     */
    private static resolveShippedFont(fonts: Record<string, string>, file: string): Buffer {
        const font: string | undefined = fonts[file];
        if (font == undefined) {
            throw new InternalError(`The installed pdfmake ships no font "${file}".`);
        }
        return Buffer.from(font, 'base64');
    }
}