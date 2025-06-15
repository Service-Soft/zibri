export enum MimeType {
    JSON = 'application/json',
    HTML = 'text/html',
    FORM_DATA = 'multipart/form-data',
    OCTET_STREAM = 'application/octet-stream'
}

export function isMimeType(value: string): value is MimeType {
    return Object.values(MimeType).includes(value as MimeType);
}