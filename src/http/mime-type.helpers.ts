import { FileMimeType, LooseFileMimeType, MimeType } from './mime-type.enum';

/**
 * All possible file extensions.
 */
export type FileExtension = typeof mimeTypeToExtension[FileMimeType] | '.jpg';

// eslint-disable-next-line typescript/typedef
const mimeTypeToExtension = {
    [MimeType.JSON]: '.json',
    [MimeType.HTML]: '.html',
    [MimeType.PNG]: '.png',
    [MimeType.JPEG]: '.jpeg',
    [MimeType.ZIP]: '.zip',
    [MimeType.SVG]: '.svg',
    [MimeType.CSS]: '.css',
    [MimeType.TTF]: '.ttf',
    [MimeType.PDF]: '.pdf',
    [MimeType.CSV]: '.csv',
    [MimeType.XLSX]: '.xlsx',
    [MimeType.DOCX]: '.docx',
    [MimeType.TXT]: '.txt',
    [MimeType.XML]: '.xml'
} satisfies Record<FileMimeType, Lowercase<`.${string}`> | undefined>;

const extensionToMimeType: Record<FileExtension, MimeType | undefined> = {
    '.css': MimeType.CSS,
    '.png': MimeType.PNG,
    '.jpg': MimeType.JPEG,
    '.jpeg': MimeType.JPEG,
    '.svg': MimeType.SVG,
    '.zip': MimeType.ZIP,
    '.ttf': MimeType.TTF,
    '.pdf': MimeType.PDF,
    '.csv': MimeType.CSV,
    '.xlsx': MimeType.XLSX,
    '.json': MimeType.JSON,
    '.docx': MimeType.DOCX,
    '.txt': MimeType.TXT,
    '.html': MimeType.HTML,
    '.xml': MimeType.XML
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
    const extension: FileExtension | undefined = mimeTypeToExtension[type as FileMimeType];
    return extension;
}

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given value is a known mime type.
 * @param value - The value to check.
 */
export function isMimeType(value: string): value is MimeType {
    return Object.values(MimeType).includes(value as MimeType);
}