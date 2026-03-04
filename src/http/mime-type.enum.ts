import { ExcludeStrict } from '../types/exclude-strict.type';

/**
 * All known mime types.
 */
export enum MimeType {
    JSON = 'application/json',
    XML = 'application/xml',
    HTML = 'text/html',
    FORM_DATA = 'multipart/form-data',
    FORM_URL_ENCODED = 'application/x-www-form-urlencoded',
    OCTET_STREAM = 'application/octet-stream',
    PNG = 'image/png',
    JPEG = 'image/jpeg',
    ZIP = 'application/zip',
    SVG = 'image/svg+xml',
    CSS = 'text/css',
    TTF = 'font/ttf',
    PDF = 'application/pdf',
    CSV = 'text/csv',
    XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    TXT = 'text/plain'
}

/**
 * File mime types.
 */
export type FileMimeType = ExcludeStrict<MimeType, MimeType.OCTET_STREAM | MimeType.FORM_DATA | MimeType.FORM_URL_ENCODED>;

/**
 * File mime types with the possibility to provide custom mime types.
 */
export type LooseFileMimeType = FileMimeType | string & {};