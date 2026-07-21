import { FileMimeType, LooseFileMimeType, MimeType } from './mime-type.enum';
import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * All possible file extensions.
 */
export type FileExtension = NonNullable<(typeof mimeTypeToExtensions)[keyof typeof mimeTypeToExtensions]>[number];

// eslint-disable-next-line typescript/typedef
const mimeTypeToExtensions = {
    [MimeType.JSON]: ['.json'],
    [MimeType.HTML]: ['.html', '.htm'],
    [MimeType.PNG]: ['.png'],
    // eslint-disable-next-line cspell/spellchecker
    [MimeType.JPEG]: ['.jpeg', '.jpg', '.jpe', '.jfif'],
    [MimeType.ZIP]: ['.zip'],
    // eslint-disable-next-line cspell/spellchecker
    [MimeType.SVG]: ['.svg', '.svgz'],
    [MimeType.CSS]: ['.css'],
    [MimeType.TTF]: ['.ttf'],
    [MimeType.PDF]: ['.pdf'],
    [MimeType.CSV]: ['.csv'],
    [MimeType.XLSX]: ['.xlsx'],
    [MimeType.DOCX]: ['.docx'],
    [MimeType.TXT]: ['.txt'],
    [MimeType.XML]: ['.xml'],
    [MimeType.GZIP]: ['.gz', '.gzip'],
    [MimeType.TAR]: ['.tar'],
    [MimeType.WASM]: ['.wasm'],
    // eslint-disable-next-line cspell/spellchecker
    [MimeType.JSON_LD]: ['.jsonld', '.json-ld'],
    // eslint-disable-next-line cspell/spellchecker
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

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given value is a known mime type.
 * @param value - The value to check.
 */
export function isMimeType(value: string): value is MimeType {
    return ObjectUtilities.values(MimeType).includes(value as MimeType);
}