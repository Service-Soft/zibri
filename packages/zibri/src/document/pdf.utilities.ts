import type PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions, Column, Content, Size, ImageDefinition, BufferOptions } from 'pdfmake/interfaces.js';

import { InternalError } from '../error-handling/internal-error.model.ts';
import { optionalPeer } from '../utilities/optional-peer.function.ts';

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
     * The file content of the attachment. A string value is interpreted as a file path.
     */
    src: string | ArrayBuffer | Buffer<ArrayBufferLike>,
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
 * Provides functionality around dealing with pdf files.
 */
export abstract class PdfUtilities {
    private static printerInstance: PdfPrinter | undefined;

    /**
     * The printer, built the first time a document is made.
     *
     * Not a field, because a field is built when this class is evaluated - which is when the barrel
     * that re-exports it is loaded, so an application that never makes a pdf would still need the
     * optional peer dependency behind it. Kept afterwards because it holds the fonts it read.
     * @returns The printer.
     */
    private static get printer(): PdfPrinter {
        // the module is the constructor - pdfmake sets `module.exports` to it, so there is no
        // `default` to reach through the way an esm style import would suggest
        const Printer: typeof PdfPrinter = optionalPeer<typeof PdfPrinter>('pdfmake', 'Creating a pdf');
        // the static cuts of Roboto that pdfmake ships with its browser build, base64 by file name.
        // Static ones, because pdfkit draws a variable font at its default weight only, so bold text
        // set in one comes out regular
        const fonts: Record<string, string> = optionalPeer<Record<string, string>>('pdfmake/build/vfs_fonts', 'Creating a pdf');
        this.printerInstance ??= new Printer({
            Roboto: {
                normal: this.resolveFont(fonts, 'Roboto-Regular.ttf'),
                bold: this.resolveFont(fonts, 'Roboto-Medium.ttf'),
                italics: this.resolveFont(fonts, 'Roboto-Italic.ttf'),
                // cspell:disable-next-line
                bolditalics: this.resolveFont(fonts, 'Roboto-MediumItalic.ttf')
            }
        });
        return this.printerInstance;
    }
    /**
     * Creates a pdf from the provided definition.
     * @param documentDefinition - The definition to create the pdf from.
     * @param options - Additional options regarding the buffer.
     * @returns A readable of the newly created pdf.
     */
    static create(documentDefinition: PdfDocumentDefinition, options: PdfBufferOptions | undefined): PdfDocument {
        const doc: PdfDocument = this.printer.createPdfKitDocument(documentDefinition, options);
        for (const attachment of documentDefinition.attachments) {
            doc.file(attachment.src, attachment.options);
        }
        return doc;
    }

    /**
     * Reads one of the fonts pdfmake ships.
     * @param fonts - The fonts, base64 by file name.
     * @param file - The file name of the font.
     * @returns The font.
     * @throws InternalError when the installed pdfmake does not ship the font.
     */
    private static resolveFont(fonts: Record<string, string>, file: string): Buffer {
        const font: string | undefined = fonts[file];
        if (font == undefined) {
            throw new InternalError(`The installed pdfmake ships no font "${file}".`);
        }
        return Buffer.from(font, 'base64');
    }
}