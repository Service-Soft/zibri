import { FileMimeType, LooseFileMimeType, MimeType } from './mime-type.enum.ts';
import { ObjectUtilities } from '../utilities/object.utilities.ts';

/**
 * All possible file extensions.
 */
export type FileExtension = NonNullable<(typeof mimeTypeToExtensions)[keyof typeof mimeTypeToExtensions]>[number];

// eslint-disable-next-line typescript-js/typedef
const mimeTypeToExtensions = {
    [MimeType.JSON]: ['.json'],
    [MimeType.HTML]: ['.html', '.htm'],
    [MimeType.PNG]: ['.png'],
    // cspell:disable-next-line
    [MimeType.JPEG]: ['.jpeg', '.jpg', '.jpe', '.jfif'],
    [MimeType.ZIP]: ['.zip'],
    // cspell:disable-next-line
    [MimeType.SVG]: ['.svg', '.svgz'],
    [MimeType.CSS]: ['.css'],
    [MimeType.TTF]: ['.ttf'],
    [MimeType.PDF]: ['.pdf'],
    [MimeType.CSV]: ['.csv'],
    [MimeType.XLSX]: ['.xlsx'],
    [MimeType.DOCX]: ['.docx'],
    [MimeType.TXT]: ['.txt'],
    [MimeType.XML]: ['.xml'],
    [MimeType.TEXT_XML]: ['.xml'],
    [MimeType.GZIP]: ['.gz', '.gzip'],
    [MimeType.TAR]: ['.tar'],
    [MimeType.WASM]: ['.wasm'],
    // cspell:disable-next-line
    [MimeType.JSON_LD]: ['.jsonld', '.json-ld'],
    // cspell:disable-next-line
    [MimeType.NDJSON]: ['.ndjson', '.jsonl'],
    [MimeType.PPTX]: ['.pptx'],
    [MimeType.JAVASCRIPT]: ['.js', '.cjs', '.mjs'],
    [MimeType.YAML]: ['.yaml', '.yml'],
    [MimeType.GIF]: ['.gif'],
    [MimeType.WEBP]: ['.webp'],
    [MimeType.ICO]: ['.ico', '.cur'],
    [MimeType.BMP]: ['.bmp', '.dib'],
    [MimeType.TIFF]: ['.tif', '.tiff'],
    [MimeType.AVIF]: ['.avif'],
    [MimeType.MP3]: ['.mp3'],
    [MimeType.WAV]: ['.wav'],
    [MimeType.OGG_AUDIO]: ['.ogg', '.oga'],
    [MimeType.WEBM_AUDIO]: ['.weba'],
    [MimeType.MP4]: ['.mp4', '.m4v'],
    [MimeType.WEBM_VIDEO]: ['.webm'],
    [MimeType.OGG_VIDEO]: ['.ogv'],
    [MimeType.OTF]: ['.otf'],
    [MimeType.WOFF]: ['.woff'],
    [MimeType.WOFF2]: ['.woff2']
} satisfies Record<FileMimeType, readonly Lowercase<`.${string}`>[] | undefined>;

const extensionToMimeType: Record<FileExtension, MimeType | undefined> = {
    '.json': MimeType.JSON,
    '.html': MimeType.HTML,
    '.htm': MimeType.HTML,
    '.png': MimeType.PNG,
    '.jpeg': MimeType.JPEG,
    '.jpg': MimeType.JPEG,
    '.jpe': MimeType.JPEG,
    // cspell:disable-next-line
    '.jfif': MimeType.JPEG,
    '.zip': MimeType.ZIP,
    '.svg': MimeType.SVG,
    // cspell:disable-next-line
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
    // cspell:disable-next-line
    '.jsonld': MimeType.JSON_LD,
    '.json-ld': MimeType.JSON_LD,
    // cspell:disable-next-line
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
} as const;

/**
 * Resolves the mime type of the file at the given path.
 * @param path - The path to resolve the mime type for.
 * @returns The resolved mimetype.
 */
export function resolveMimeType(path: string): MimeType {
    const index: number = path.lastIndexOf('.');
    const extension: FileExtension = path.substring(index).toLowerCase() as FileExtension;
    const mimeType: MimeType | undefined = extensionToMimeType[extension];
    return mimeType ?? MimeType.OCTET_STREAM;
}

/**
 * Resolves the file extension from the given loose file mime type.
 * @param type - The mime type to resolve the file extension for.
 * @returns The resolved file extension or undefined if it could not be resolved.
 */
export function resolveFileExtension(type: LooseFileMimeType): FileExtension | undefined {
    const extension: FileExtension | undefined = mimeTypeToExtensions[type as FileMimeType]?.at(0);
    return extension;
}

// eslint-disable-next-line jsdoc-js/require-returns
/**
 * Checks if the given value is a known mime type.
 * @param value - The value to check.
 */
export function isMimeType(value: string): value is MimeType {
    return ObjectUtilities.values(MimeType).includes(value as MimeType);
}

/**
 * Checks if the given value is one of the generic media types of xml: `application/xml` or `text/xml`.
 * @param value - The media type to check, without parameters.
 * @returns True when content of that type is plain xml.
 */
export function isXmlMimeType(value: string): boolean {
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
export function isJsonMimeType(value: string): boolean {
    return value === MimeType.JSON || /^application\/[\w!#$&.^-]+\+json$/.test(value);
}

/**
 * The types a response body is worth encoding for.
 *
 * Everything here is text or is stored as text. What is missing is missing on purpose: an image, a
 * video, a font and an office document are containers that are already compressed, so encoding one
 * spends cpu to add a few bytes. `EVENT_STREAM` is the exception that is neither - it compresses
 * well and must not be encoded anyway, because an encoder holds bytes back until it has enough of
 * them to be worth writing, and an event nobody receives until the next one arrives is the one thing
 * a stream of events must not do.
 */
const compressibleMimeTypes: Set<MimeType> = new Set([
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
 * Whether a body of this content type is worth encoding on the way out.
 *
 * A type this does not know answers no. Being wrong the other way costs a client its body, since
 * whatever produced an unknown type may well have compressed it already.
 * @param contentType - A content type header, parameters and all.
 * @returns True when compressing a body of that type saves more than it costs.
 */
export function isCompressibleMimeType(contentType: string): boolean {
    const type: string = (contentType.split(';')[0] ?? contentType).trim()
        .toLowerCase();
    return isMimeType(type) && compressibleMimeTypes.has(type);
}