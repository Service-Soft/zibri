import { ExcludeStrict } from '../types/exclude-strict.type.ts';

/**
 * All known mime types.
 */
export enum MimeType {
    // Application
    JSON = 'application/json',
    XML = 'application/xml',
    FORM_DATA = 'multipart/form-data',
    FORM_URL_ENCODED = 'application/x-www-form-urlencoded',
    OCTET_STREAM = 'application/octet-stream',
    PDF = 'application/pdf',
    ZIP = 'application/zip',
    GZIP = 'application/gzip',
    TAR = 'application/x-tar',
    WASM = 'application/wasm',
    JSON_LD = 'application/ld+json',
    JSON_SCIM = 'application/scim+json',
    // cspell:disable-next-line
    NDJSON = 'application/x-ndjson',
    XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // cspell:disable-next-line
    PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    HTML = 'text/html',
    CSS = 'text/css',
    CSV = 'text/csv',
    TXT = 'text/plain',
    JAVASCRIPT = 'text/javascript',
    YAML = 'text/yaml',
    TEXT_XML = 'text/xml',
    EVENT_STREAM = 'text/event-stream',
    // Image
    PNG = 'image/png',
    JPEG = 'image/jpeg',
    GIF = 'image/gif',
    WEBP = 'image/webp',
    SVG = 'image/svg+xml',
    ICO = 'image/x-icon',
    BMP = 'image/bmp',
    TIFF = 'image/tiff',
    AVIF = 'image/avif',
    // Audio
    MP3 = 'audio/mpeg',
    WAV = 'audio/wav',
    OGG_AUDIO = 'audio/ogg',
    WEBM_AUDIO = 'audio/webm',
    // Video
    MP4 = 'video/mp4',
    WEBM_VIDEO = 'video/webm',
    OGG_VIDEO = 'video/ogg',
    // Font
    TTF = 'font/ttf',
    OTF = 'font/otf',
    WOFF = 'font/woff',
    WOFF2 = 'font/woff2'
}

/**
 * File mime types.
 */
export type FileMimeType = ExcludeStrict<
    MimeType,
    MimeType.OCTET_STREAM
    | MimeType.FORM_DATA
    | MimeType.FORM_URL_ENCODED
    | MimeType.EVENT_STREAM
    | MimeType.JSON_SCIM
>;

/**
 * File mime types with the possibility to provide custom mime types.
 */
export type LooseFileMimeType = FileMimeType | string & {};