import { readFileSync } from 'node:fs';
import path from 'node:path';

import type PdfPrinter from 'pdfmake';
import type { BufferOptions, TDocumentDefinitions } from 'pdfmake/interfaces';

import { InternalError } from '../error-handling/internal-error.model';
import { optionalPeer, optionalPeerDependency } from '../utilities/optional-peer.function';
import { PdfAccessOptions } from './pdf-access-options.model';
import { PdfGlyphCoverage } from './pdf-font-fallback.utilities';
import { PdfFontFamily, PdfFontFile } from './pdf-font-options.model';

/**
 * The font descriptors a pdfmake printer is built with.
 */
export type PdfmakeFontDescriptors = Record<string, Record<'normal' | 'bold' | 'italics' | 'bolditalics', PdfFontFile>>;

/**
 * A font as fontkit reads it, which the pdfkit of pdfmake 0.3 sets text in as it is.
 */
type Pdfmake03Font = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    layout: (text: string) => unknown
};

/**
 * The font descriptors a printer of pdfmake 0.3 is built with, each font read once.
 */
type Pdfmake03FontDescriptors = Record<string, Record<'normal' | 'bold' | 'italics' | 'bolditalics', Pdfmake03Font>>;

/**
 * What fontkit is used for: reading which characters a font can draw, and reading a font once for every document
 * pdfmake 0.3 sets in it.
 */
export type PdfmakeFontkit = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    create: (buffer: Buffer) => Partial<PdfGlyphCoverage & Pdfmake03Font>
};

/**
 * Makes the pdfkit document of a definition with the installed pdfmake.
 */
export type PdfmakePrinter = {
    /**
     * False with pdfmake 0.2, which makes the document as it is asked.
     */
    createsAsynchronously: false,
    /**
     * Makes the document.
     */
    create: (definition: TDocumentDefinitions, options: BufferOptions | undefined) => PDFKit.PDFDocument
} | {
    /**
     * True with pdfmake 0.3, which makes the document asynchronously, after fetching the URLs it names.
     */
    createsAsynchronously: true,
    /**
     * Makes the document, reading and fetching only what the access options allow.
     */
    create: (definition: TDocumentDefinitions, options: BufferOptions | undefined, access: PdfAccessOptions) => Promise<PDFKit.PDFDocument>
};

/**
 * The versions of pdfmake a pdf can be made with.
 */
type PdfmakeVersion = '0.2' | '0.3';

/**
 * What the package.json of pdfmake is read for.
 */
type PdfmakeManifest = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    version: string
};

/**
 * The virtual file system of pdfmake 0.3, where a document keeps what it fetched.
 */
type Pdfmake03Files = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    existsSync: (file: string) => boolean
};

/**
 * Fetches the URLs a document of pdfmake 0.3 names, into its files.
 */
type Pdfmake03UrlResolver = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    setUrlAccessPolicy: (allow: (url: string) => boolean) => void
};

/**
 * The printer of pdfmake 0.3, which lays a definition out into a pdfkit document.
 */
type Pdfmake03Printer = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    createPdfKitDocument: (definition: TDocumentDefinitions, options: BufferOptions | undefined) => Promise<PDFKit.PDFDocument>
};

/**
 * The modules of pdfmake 0.3 a printer is built from, as its own `createPdf` builds one.
 */
type Pdfmake03 = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    Printer: new (
        fonts: Pdfmake03FontDescriptors,
        files: Pdfmake03Files,
        urls: Pdfmake03UrlResolver,
        allowFile: (file: string) => boolean,
        cacheUrls: boolean
    ) => Pdfmake03Printer,
    // eslint-disable-next-line jsdoc/require-jsdoc
    UrlResolver: new (files: Pdfmake03Files, sharedFiles: Pdfmake03Files) => Pdfmake03UrlResolver,
    // eslint-disable-next-line jsdoc/require-jsdoc
    VirtualFileSystem: new () => Pdfmake03Files
};

/**
 * A module of pdfmake 0.3 whose export is its `default`, as babel writes an es module out as commonjs.
 */
type Pdfmake03DefaultExport<T> = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    default: T
};

/**
 * The module of pdfmake 0.3 its virtual file system is exported from.
 */
type Pdfmake03VirtualFsModule = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    VirtualFileSystem: Pdfmake03['VirtualFileSystem']
};

/**
 * What a pdf needs pdfmake for, in the messages of a pdfmake that is missing.
 */
const NEEDED_FOR: string = 'Creating a pdf';

/**
 * The installed pdfmake, 0.2 or 0.3, and the parts of it a pdf is made with.
 */
export abstract class PdfmakeUtilities {
    /**
     * The package pdfmake is loaded from.
     */
    // the tests set it to `pdfmake-0.3`, the 0.3 installed beside 0.2 under a name of its own, and to `pdfmake` for
    // the suites that run on both. Nothing else sets it
    static packageName: string = 'pdfmake';

    /**
     * Builds a printer of the installed pdfmake.
     * @param descriptors - The fonts it sets documents in.
     * @returns The printer.
     */
    static resolvePrinter(descriptors: PdfmakeFontDescriptors): PdfmakePrinter {
        switch (this.resolveVersion()) {
            case '0.2': {
                // the module is the constructor - pdfmake sets `module.exports` to it, so there is no
                // `default` to reach through the way an esm style import would suggest
                const Printer: typeof PdfPrinter = optionalPeer<typeof PdfPrinter>(this.packageName, NEEDED_FOR);
                const printer: PdfPrinter = new Printer(descriptors);
                return {
                    createsAsynchronously: false,
                    create: (definition, options) => printer.createPdfKitDocument(definition, options)
                };
            }
            case '0.3': {
                const modules: Pdfmake03 = this.resolveModulesOf03();
                // read here, so that what the access options allow is about what a definition names alone: the
                // fonts are the application's, and pdfmake would refuse a path to one outside the allowed folders.
                // And read by fontkit here, once for every document: handed the file, pdfkit reads it again for each
                // one, which is most of what a short document costs. A document embeds a subset of its own and
                // leaves the font it read the glyphs from as it was
                const fontkit: PdfmakeFontkit = this.resolveFontkit();
                const read: Map<PdfFontFile, Pdfmake03Font> = new Map();
                const readOnce: (name: string, file: PdfFontFile) => Pdfmake03Font = (name, file) => {
                    const existing: Pdfmake03Font | undefined = read.get(file);
                    if (existing != undefined) {
                        return existing;
                    }
                    const font: Partial<PdfGlyphCoverage & Pdfmake03Font> = fontkit.create(this.readFont(file));
                    if (!this.isPdfmake03Font(font)) {
                        throw new InternalError(
                            `The pdf font family "${name}" is a collection of fonts.`
                            + ' Give it the file of one font, such as an .otf or .ttf file.'
                        );
                    }
                    read.set(file, font);
                    return font;
                };
                const fonts: Pdfmake03FontDescriptors = {};
                for (const [name, family] of Object.entries(descriptors)) {
                    fonts[name] = {
                        normal: readOnce(name, family.normal),
                        bold: readOnce(name, family.bold),
                        italics: readOnce(name, family.italics),
                        bolditalics: readOnce(name, family.bolditalics)
                    };
                }
                return {
                    createsAsynchronously: true,
                    create: (definition, options, access) => this.resolveDocumentOf03(modules, fonts, definition, options, access)
                };
            }
        }
    }

    /**
     * Reads the static cuts of Roboto that pdfmake ships.
     * @returns The family.
     */
    static resolveRoboto(): PdfFontFamily {
        // the ones of its browser build, base64 by file name, which 0.2 and 0.3 ship alike. Static ones, because
        // pdfkit draws a variable font at its default weight only, so bold text set in one comes out regular
        const shipped: Record<string, string> = optionalPeer<Record<string, string>>(`${this.packageName}/build/vfs_fonts`, NEEDED_FOR);
        return {
            normal: this.resolveShippedFont(shipped, 'Roboto-Regular.ttf'),
            bold: this.resolveShippedFont(shipped, 'Roboto-Medium.ttf'),
            italics: this.resolveShippedFont(shipped, 'Roboto-Italic.ttf'),
            bolditalics: this.resolveShippedFont(shipped, 'Roboto-MediumItalic.ttf')
        };
    }

    /**
     * Loads the fontkit the installed pdfmake draws with.
     * @returns The fontkit.
     */
    static resolveFontkit(): PdfmakeFontkit {
        // the one pdfmake draws with, so the characters a family is said to have are the ones it draws: 0.2 draws
        // with a fork of pdfkit and of fontkit, 0.3 with pdfkit and fontkit themselves
        const neededFor: string = 'Font fallbacks in a pdf';
        switch (this.resolveVersion()) {
            case '0.2': {
                return optionalPeerDependency<PdfmakeFontkit>(
                    [this.packageName, '@foliojs-fork/pdfkit'],
                    '@foliojs-fork/fontkit',
                    neededFor
                );
            }
            case '0.3': {
                return optionalPeerDependency<PdfmakeFontkit>([this.packageName, 'pdfkit'], 'fontkit', neededFor);
            }
        }
    }

    /**
     * Reads which version of pdfmake is installed.
     * @returns The version.
     * @throws InternalError when it is neither 0.2 nor 0.3.
     */
    private static resolveVersion(): PdfmakeVersion {
        // the package first, so that a missing one is reported as the package to install
        optionalPeer(this.packageName, NEEDED_FOR);
        const { version }: PdfmakeManifest = optionalPeer(`${this.packageName}/package.json`, NEEDED_FOR);
        if (version.startsWith('0.2.')) {
            return '0.2';
        }
        if (version.startsWith('0.3.')) {
            return '0.3';
        }
        throw new InternalError(`${NEEDED_FOR} needs pdfmake 0.2 or 0.3, and ${version} is installed.`);
    }

    /**
     * Loads the modules of pdfmake 0.3 a printer is built from.
     * @returns The modules.
     */
    private static resolveModulesOf03(): Pdfmake03 {
        // its parts rather than the `pdfmake` the package exports, which is one instance every module of the
        // process shares, and which an application may have configured for pdfs of its own
        const name: string = this.packageName;
        const printer: Pdfmake03DefaultExport<Pdfmake03['Printer']> = optionalPeer(`${name}/js/Printer`, NEEDED_FOR);
        const urlResolver: Pdfmake03DefaultExport<Pdfmake03['UrlResolver']> = optionalPeer(`${name}/js/URLResolver`, NEEDED_FOR);
        const virtualFs: Pdfmake03VirtualFsModule = optionalPeer(`${name}/js/virtual-fs`, NEEDED_FOR);
        return { Printer: printer.default, UrlResolver: urlResolver.default, VirtualFileSystem: virtualFs.VirtualFileSystem };
    }

    /**
     * Makes a document with pdfmake 0.3.
     * @param modules - The modules of pdfmake 0.3.
     * @param fonts - The fonts, read.
     * @param definition - The definition.
     * @param options - Additional options regarding the buffer.
     * @param access - What the document may read and fetch besides its definition.
     * @returns The document.
     */
    private static async resolveDocumentOf03(
        modules: Pdfmake03,
        fonts: Pdfmake03FontDescriptors,
        definition: TDocumentDefinitions,
        options: BufferOptions | undefined,
        access: PdfAccessOptions
    ): Promise<PDFKit.PDFDocument> {
        // a file system and a resolver for each document, as pdfmake's own `createPdf` builds them, but none shared
        // between documents: what one document fetched is no other's to read
        const files: Pdfmake03Files = new modules.VirtualFileSystem();
        const urls: Pdfmake03UrlResolver = new modules.UrlResolver(files, files);
        // pdfmake refuses with an error of its own when a policy answers false. Throwing instead says what to
        // allow, and pdfmake calls both policies outside of anything that would catch it
        urls.setUrlAccessPolicy(url => {
            this.validateUrlAccess(url, access);
            return true;
        });
        const allowFile: (file: string) => boolean = file => {
            this.validateFileAccess(file, access);
            return true;
        };
        const printer: Pdfmake03Printer = new modules.Printer(fonts, files, urls, allowFile, false);
        return await printer.createPdfKitDocument(definition, options);
    }

    /**
     * Checks that a pdf may read a file.
     * @param file - The path of the file, as the definition names it.
     * @param access - What the pdf may read.
     * @throws InternalError when the file is in none of the allowed folders.
     */
    private static validateFileAccess(file: string, access: PdfAccessOptions): void {
        // relative to the working directory, as pdfkit reads it. By its path alone, so a link inside an allowed
        // folder is read wherever it points: only the application puts one there
        const resolved: string = path.resolve(file);
        const inside: boolean = access.allowedFolders.some(folder => {
            const relative: string = path.relative(path.resolve(folder), resolved);
            return relative !== ''
                && relative !== '..'
                && !relative.startsWith(`..${path.sep}`)
                && !path.isAbsolute(relative);
        });
        if (!inside) {
            throw new InternalError(
                `The pdf may not read "${file}": it is in none of the allowedFolders of ZIBRI_DI_TOKENS.PDF_ACCESS_OPTIONS.`
            );
        }
    }

    /**
     * Checks that a pdf may fetch a URL.
     * @param url - The URL.
     * @param access - What the pdf may fetch.
     * @throws InternalError when `allowUrl` does not allow it.
     */
    private static validateUrlAccess(url: string, access: PdfAccessOptions): void {
        if (access.allowUrl?.(url) !== true) {
            throw new InternalError(`The pdf may not fetch "${url}": allowUrl of ZIBRI_DI_TOKENS.PDF_ACCESS_OPTIONS does not allow it.`);
        }
    }

    /**
     * The content of a font file.
     * @param file - The file, or its content.
     * @returns Its content.
     */
    private static readFont(file: PdfFontFile): Buffer {
        return Buffer.isBuffer(file) ? file : readFileSync(file);
    }

    // a collection of fonts, as fontkit reads a .ttc file, has no layout of its own
    private static isPdfmake03Font(font: Partial<Pdfmake03Font>): font is Pdfmake03Font {
        return typeof font.layout === 'function';
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