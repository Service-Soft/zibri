export enum MimeType {
    JSON = 'application/json',
    HTML = 'text/html',
    FORM_DATA = 'multipart/form-data',
    OCTET_STREAM = 'application/octet-stream',
    PNG = 'image/png',
    JPEG = 'image/jpeg',
    ZIP = 'application/zip',
    SVG = 'image/svg+xml',
    CSS = 'text/css',
    TTF = 'font/ttf',
    PDF = 'application/pdf',
    CSV = 'text/csv',
    EML = 'message/rfc822',
    XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    TXT = 'text/plain'
}

export type LooseMimeType = MimeType | string & {};

export function isMimeType(value: string): value is MimeType {
    return Object.values(MimeType).includes(value as MimeType);
}