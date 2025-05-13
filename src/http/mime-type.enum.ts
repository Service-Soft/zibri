export enum MimeType {
    JSON = 'application/json',
    HTML = 'text/html'
}

export function isMimeType(value: string): value is MimeType {
    return Object.values(MimeType).includes(value as MimeType);
}