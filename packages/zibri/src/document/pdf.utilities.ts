import { readFileSync } from 'node:fs';

import type { TDocumentDefinitions, Column, Content, Size, ImageDefinition, BufferOptions, PageSize } from 'pdfmake/interfaces';

import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getAllRegisteredTokens } from '../di/get-all-registered-tokens.function';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { FsPath } from '../utilities/fs.utilities';
import { PdfAccessOptions } from './pdf-access-options.model';
import { PdfFontFallbackUtilities, PdfGlyphCoverage } from './pdf-font-fallback.utilities';
import { PdfFontFamily, PdfFontFile, PdfFontOptions } from './pdf-font-options.model';
import { PdfmakeFontDescriptors, PdfmakeFontkit, PdfmakePrinter, PdfmakeUtilities } from './pdfmake.utilities';

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
 * A printer, and what each of its families can draw.
 */
type PdfFontSetup = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    pdfmake: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    printer: PdfmakePrinter,
    // eslint-disable-next-line jsdoc/require-jsdoc
    coverage: ReadonlyMap<string, PdfGlyphCoverage>
};

/**
 * The fonts of a pdf made outside an application: Roboto, and nothing to stand in for it. One object,
 * so that every such pdf shares one printer.
 */
const ROBOTO_ALONE: PdfFontOptions = { families: {}, fallbacks: [] };

/**
 * What a pdf made outside an application may read besides its definition: nothing.
 */
const NOTHING_ALLOWED: PdfAccessOptions = { allowedFolders: [] };

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
     * Creates a pdf from the provided definition, with pdfmake 0.2 or 0.3.
     *
     * Each character of a text the font of the text cannot draw is set in the first of the
     * `fallbacks` of the fonts that can.
     * @param documentDefinition - The definition to create the pdf from.
     * @param options - Additional options regarding the buffer.
     * @param fonts - The fonts the pdf may be set in. The application's, from `ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS`,
     * by default, and Roboto alone outside an application.
     * @param access - The files and URLs the pdf may read, with pdfmake 0.3. The application's, from
     * `ZIBRI_DI_TOKENS.PDF_ACCESS_OPTIONS`, by default, and none outside an application.
     * @returns A readable of the newly created pdf.
     * @throws InternalError with pdfmake 0.3, when the definition names a file or a URL the access options do not
     * allow.
     */
    static async resolve(
        documentDefinition: PdfDocumentDefinition,
        options?: PdfBufferOptions,
        fonts: PdfFontOptions = this.resolveFontOptions(),
        access: PdfAccessOptions = this.resolveAccessOptions()
    ): Promise<PdfDocument> {
        const setup: PdfFontSetup = this.resolveSetup(fonts);
        const { attachments, ...definition }: PdfDocumentDefinition = this.applyFallbacks(documentDefinition, fonts, setup);
        const doc: PdfDocument = setup.printer.createsAsynchronously
            ? await setup.printer.create(definition, options, access)
            : setup.printer.create(definition, options);
        this.attach(doc, attachments);
        return doc;
    }

    /**
     * Creates a pdf from the provided definition, with pdfmake 0.2.
     *
     * Each character of a text the font of the text cannot draw is set in the first of the
     * `fallbacks` of the fonts that can.
     * @deprecated Use {@link PdfUtilities.resolve}, which works with pdfmake 0.2 and 0.3. Removed in 4.0.
     * @param documentDefinition - The definition to create the pdf from.
     * @param options - Additional options regarding the buffer.
     * @param fonts - The fonts the pdf may be set in. The application's, from `ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS`,
     * by default, and Roboto alone outside an application.
     * @returns A readable of the newly created pdf.
     * @throws InternalError with pdfmake 0.3, which creates a pdf asynchronously.
     */
    static create(
        documentDefinition: PdfDocumentDefinition,
        options: PdfBufferOptions | undefined,
        fonts: PdfFontOptions = this.resolveFontOptions()
    ): PdfDocument {
        const setup: PdfFontSetup = this.resolveSetup(fonts);
        if (setup.printer.createsAsynchronously) {
            throw new InternalError(
                'pdfmake 0.3 creates a pdf asynchronously, which PdfUtilities.create cannot wait for. Use PdfUtilities.resolve.'
            );
        }
        const { attachments, ...definition }: PdfDocumentDefinition = this.applyFallbacks(documentDefinition, fonts, setup);
        const doc: PdfDocument = setup.printer.create(definition, options);
        this.attach(doc, attachments);
        return doc;
    }

    /**
     * Sets each character a text's font cannot draw in the first of the fallbacks that can.
     * @param documentDefinition - The definition.
     * @param fonts - The fonts.
     * @param setup - What each family can draw.
     * @returns The definition with its texts split. The same definition when no fallback is registered.
     */
    private static applyFallbacks(
        documentDefinition: PdfDocumentDefinition,
        fonts: PdfFontOptions,
        setup: PdfFontSetup
    ): PdfDocumentDefinition {
        // nothing to look at when nothing stands in, which is every application that registered no fallback
        return fonts.fallbacks.length === 0
            ? documentDefinition
            : PdfFontFallbackUtilities.apply(documentDefinition, {
                coverage: setup.coverage,
                fallbacks: fonts.fallbacks,
                styles: undefined
            });
    }

    /**
     * Adds the attachments of a definition to its pdf.
     * @param doc - The pdf.
     * @param attachments - The attachments.
     */
    private static attach(doc: PdfDocument, attachments: PdfAttachmentDefinition[]): void {
        // added here rather than handed to pdfmake, which 0.2 does not attach and 0.3 reads as the files a
        // content element links to by their name. With 0.3, a path is read only inside the allowed folders
        for (const attachment of attachments) {
            doc.file(attachment.src, attachment.options);
        }
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
     * What the pdfs of the running application may read.
     * @returns Its access options, or nothing allowed when no application has registered any, such as in a script.
     */
    private static resolveAccessOptions(): PdfAccessOptions {
        return getAllRegisteredTokens().includes(ZIBRI_DI_TOKENS.PDF_ACCESS_OPTIONS)
            ? inject(ZIBRI_DI_TOKENS.PDF_ACCESS_OPTIONS)
            : NOTHING_ALLOWED;
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
        // a printer is one of the pdfmake that built it, and the tests switch between 0.2 and 0.3
        if (existing?.pdfmake === PdfmakeUtilities.packageName) {
            return existing;
        }
        const families: Record<string, PdfFontFamily> = {
            Roboto: PdfmakeUtilities.resolveRoboto(),
            ...fonts.families
        };
        const unknown: string[] = fonts.fallbacks.filter(name => families[name] == undefined);
        if (unknown.length > 0) {
            throw new InternalError(`The pdf font fallbacks name families that are not registered: ${unknown.join(', ')}.`);
        }

        const descriptors: PdfmakeFontDescriptors = {};
        for (const [name, family] of Object.entries(families)) {
            descriptors[name] = {
                normal: family.normal,
                bold: family.bold ?? family.normal,
                italics: family.italics ?? family.normal,
                bolditalics: family.bolditalics ?? family.bold ?? family.italics ?? family.normal
            };
        }
        const setup: PdfFontSetup = {
            pdfmake: PdfmakeUtilities.packageName,
            printer: PdfmakeUtilities.resolvePrinter(descriptors),
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
        const fontkit: PdfmakeFontkit = PdfmakeUtilities.resolveFontkit();
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
}