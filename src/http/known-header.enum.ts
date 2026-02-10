import { ObjectUtilities } from '../utilities';

/**
 * Known http headers.
 */
export enum KnownHeader {
    ACCEPT = 'Accept',
    ACCEPT_ENCODING = 'Accept-Encoding',
    AUTHORIZATION = 'Authorization',
    CACHE_CONTROL = 'Cache-Control',
    CONTENT_LENGTH = 'Content-Length',
    CONTENT_TYPE = 'Content-Type',
    CONTENT_DISPOSITION = 'Content-Disposition',
    COOKIE = 'Cookie',
    HOST = 'Host',
    ORIGIN = 'Origin',
    REFERER = 'Referer',
    USER_AGENT = 'User-Agent',
    X_REQUESTED_WITH = 'X-Requested-With',
    X_FORWARDED_FOR = 'X-Forwarded-For',
    X_FORWARDED_HOST = 'X-Forwarded-Host',
    X_FORWARDED_PROTO = 'X-Forwarded-Proto',
    X_REAL_IP = 'X-Real-IP',
    X_CORRELATION_ID = 'X-Correlation-ID',
    IF_NONE_MATCH = 'If-None-Match',
    IIF_MODIFIED_SINCE = 'If-Modified-Since',
    CONNECTION = 'Connection',
    DNT = 'DNT',
    SEC_FETCH_MODE = 'Sec-Fetch-Mode',
    SEC_FETCH_SITE = 'Sec-Fetch-Site',
    TE = 'TE'
}

/**
 * Checks if the given value is a known header.
 * @param value - The value to check.
 * @returns True when the KnownHeader enum values include the given value, false otherwise.
 */
export function isKnownHeader(value: string): value is KnownHeader {
    return ObjectUtilities.values(KnownHeader).includes(value as KnownHeader);
}