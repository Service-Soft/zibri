import { FileExtension, mimeTypeToExtensions } from './file-extension.model';
import { FileMimeType, LooseFileMimeType, MimeType } from './mime-type.enum';
import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * Utilities for mime types: reading them from file paths, and telling what kind of content they are.
 */
export abstract class MimeTypeUtilities {
    private static readonly extensionToMimeType: Record<FileExtension, MimeType | undefined> = {
        '.json': MimeType.JSON,
        '.html': MimeType.HTML,
        '.htm': MimeType.HTML,
        '.png': MimeType.PNG,
        '.jpeg': MimeType.JPEG,
        '.jpg': MimeType.JPEG,
        '.jpe': MimeType.JPEG,
        // eslint-disable-next-line cspell/spellchecker
        '.jfif': MimeType.JPEG,
        '.zip': MimeType.ZIP,
        '.svg': MimeType.SVG,
        // eslint-disable-next-line cspell/spellchecker
        '.svgz': MimeType.SVG,
        '.css': MimeType.CSS,
        '.ttf': MimeType.TTF,
        '.pdf': MimeType.PDF,
        '.csv': MimeType.CSV,
        '.xlsx': MimeType.XLSX,
        '.docx': MimeType.DOCX,
        '.txt': MimeType.TXT,
        '.xml': MimeType.XML,
        '.gz': MimeType.GZIP,
        '.gzip': MimeType.GZIP,
        '.tar': MimeType.TAR,
        '.wasm': MimeType.WASM,
        // eslint-disable-next-line cspell/spellchecker
        '.jsonld': MimeType.JSON_LD,
        '.json-ld': MimeType.JSON_LD,
        // eslint-disable-next-line cspell/spellchecker
        '.ndjson': MimeType.NDJSON,
        '.jsonl': MimeType.NDJSON,
        '.pptx': MimeType.PPTX,
        '.js': MimeType.JAVASCRIPT,
        '.cjs': MimeType.JAVASCRIPT,
        '.mjs': MimeType.JAVASCRIPT,
        '.yaml': MimeType.YAML,
        '.yml': MimeType.YAML,
        '.gif': MimeType.GIF,
        '.webp': MimeType.WEBP,
        '.ico': MimeType.ICO,
        '.cur': MimeType.ICO,
        '.bmp': MimeType.BMP,
        '.dib': MimeType.BMP,
        '.tif': MimeType.TIFF,
        '.tiff': MimeType.TIFF,
        '.avif': MimeType.AVIF,
        '.mp3': MimeType.MP3,
        '.wav': MimeType.WAV,
        '.ogg': MimeType.OGG_AUDIO,
        '.oga': MimeType.OGG_AUDIO,
        '.weba': MimeType.WEBM_AUDIO,
        '.mp4': MimeType.MP4,
        '.m4v': MimeType.MP4,
        '.webm': MimeType.WEBM_VIDEO,
        '.ogv': MimeType.OGG_VIDEO,
        '.otf': MimeType.OTF,
        '.woff': MimeType.WOFF,
        '.woff2': MimeType.WOFF2
    };

    // Everything here is text or is stored as text. What is missing is missing on purpose: an image, a
    // video, a font and an office document are containers that are already compressed, so encoding one
    // spends cpu to add a few bytes. `EVENT_STREAM` is the exception that is neither - it compresses
    // well and must not be encoded anyway, because an encoder holds bytes back until it has enough of
    // them to be worth writing, and an event nobody receives until the next one arrives is the one thing
    // a stream of events must not do.
    private static readonly compressibleMimeTypes: Set<MimeType> = new Set([
        MimeType.JSON,
        MimeType.JSON_LD,
        MimeType.JSON_SCIM,
        MimeType.NDJSON,
        MimeType.XML,
        MimeType.TEXT_XML,
        MimeType.FORM_URL_ENCODED,
        MimeType.WASM,
        MimeType.HTML,
        MimeType.CSS,
        MimeType.CSV,
        MimeType.TXT,
        MimeType.JAVASCRIPT,
        MimeType.YAML,
        MimeType.SVG,
        MimeType.TTF,
        MimeType.OTF
    ]);

    /**
     * Resolves the mime type of the file at the given path.
     * @param path - The path to resolve the mime type for.
     * @returns The resolved mimetype, `MimeType.OCTET_STREAM` for an unknown extension.
     */
    static resolveFromPath(path: string): MimeType {
        const index: number = path.lastIndexOf('.');
        const extension: FileExtension = path.substring(index).toLowerCase() as FileExtension;
        const mimeType: MimeType | undefined = this.extensionToMimeType[extension];
        return mimeType ?? MimeType.OCTET_STREAM;
    }

    /**
     * Resolves the file extension from the given loose file mime type.
     * @param type - The mime type to resolve the file extension for.
     * @returns The resolved file extension or undefined if it could not be resolved.
     */
    static resolveFileExtension(type: LooseFileMimeType): FileExtension | undefined {
        const extension: FileExtension | undefined = mimeTypeToExtensions[type as FileMimeType]?.at(0);
        return extension;
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Checks if the given value is a known mime type.
     * @param value - The value to check.
     */
    static isKnown(value: string): value is MimeType {
        return ObjectUtilities.values(MimeType).includes(value as MimeType);
    }

    /**
     * Checks if the given value is one of the generic media types of xml: `application/xml` or `text/xml`.
     * @param value - The media type to check, without parameters.
     * @returns True when content of that type is plain xml.
     */
    static isXml(value: string): boolean {
        // only the generic two: a `+xml` type (svg, soap, atom) is a format of its own that happens to be
        // written in xml, and reading one as plain xml is something a route would have to ask for
        return value === MimeType.XML || value === MimeType.TEXT_XML;
    }

    /**
     * Checks if the given value is a media type of json: `application/json`, or a format written in json
     * that carries the `+json` suffix (RFC 6839), such as `application/scim+json`.
     * @param value - The media type to check, without parameters.
     * @returns True when content of that type is json.
     */
    static isJson(value: string): boolean {
        return value === MimeType.JSON || /^application\/[\w!#$&.^-]+\+json$/.test(value);
    }

    /**
     * Whether a body of this content type is worth encoding on the way out.
     *
     * A type this does not know answers no, since whatever produced an unknown type may well have
     * compressed it already.
     * @param contentType - A content type header, parameters and all.
     * @returns True when compressing a body of that type saves more than it costs.
     */
    static isCompressible(contentType: string): boolean {
        const type: string = (contentType.split(';')[0] ?? contentType).trim()
            .toLowerCase();
        return this.isKnown(type) && this.compressibleMimeTypes.has(type);
    }
}