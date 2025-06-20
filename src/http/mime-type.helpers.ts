import { FileMimeType, LooseFileMimeType, MimeType } from './mime-type.enum';

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
    [MimeType.TXT]: '.txt'
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
    '.html': MimeType.HTML
} as const;

export function resolveMimeType(path: string): MimeType {
    const index: number = path.lastIndexOf('.');
    const extension: FileExtension = path.substring(index).toLowerCase() as FileExtension;
    const mimeType: MimeType | undefined = extensionToMimeType[extension];
    return mimeType ?? MimeType.OCTET_STREAM;
}

export function resolveFileExtension(type: LooseFileMimeType): FileExtension | undefined {
    const extension: FileExtension | undefined = mimeTypeToExtension[type as FileMimeType];
    return extension;
}

export function isMimeType(value: string): value is MimeType {
    return Object.values(MimeType).includes(value as MimeType);
}