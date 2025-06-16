import { MimeType } from '../http';

const extensionToMimeType: Record<Lowercase<`.${string}`>, MimeType | undefined> = {
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
    '.txt': MimeType.TXT
} as const;

export function resolveMimeType(path: string): MimeType {
    const index: number = path.lastIndexOf('.');
    const extension: Lowercase<`.${string}`> = path.substring(index).toLowerCase() as Lowercase<`.${string}`>;
    const mimeType: MimeType | undefined = extensionToMimeType[extension];
    return mimeType ?? MimeType.OCTET_STREAM;
}