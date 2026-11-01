import { FsPath } from '../utilities/fs.utilities';

/**
 * A font file of one font, TrueType or OpenType: its path, or its content.
 */
export type PdfFontFile = FsPath | Buffer;

/**
 * The files of a font family. A style without a file of its own is set in `normal`.
 */
export type PdfFontFamily = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    normal: PdfFontFile,
    // eslint-disable-next-line jsdoc/require-jsdoc
    bold?: PdfFontFile,
    // eslint-disable-next-line jsdoc/require-jsdoc
    italics?: PdfFontFile,
    // eslint-disable-next-line jsdoc/require-jsdoc
    bolditalics?: PdfFontFile
};

/**
 * The fonts a pdf may be set in, besides Roboto, which is always there.
 */
export type PdfFontOptions = {
    /**
     * The font families, by the name a document gives as `font`.
     */
    families: Record<string, PdfFontFamily>,
    /**
     * The families a character is set in, in this order, when the font of its text has no glyph for
     * it, such as a Japanese name in a Latin font. A character no family has is drawn blank.
     */
    fallbacks: string[]
};
