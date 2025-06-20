import { ExcludeStrict } from '../types';

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
    XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    TXT = 'text/plain'
}

export type FileMimeType = ExcludeStrict<MimeType, MimeType.OCTET_STREAM | MimeType.FORM_DATA>;

export type LooseFileMimeType = FileMimeType | string & {};