import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * Known http headers.
 */
export enum KnownHeader {
    ACCEPT = 'accept',
    ACCEPT_ENCODING = 'accept-encoding',
    ACCEPT_LANGUAGE = 'accept-language',
    ACCESS_CONTROL_ALLOW_ORIGIN = 'access-control-allow-origin',
    ACCESS_CONTROL_ALLOW_METHODS = 'access-control-allow-methods',
    ACCESS_CONTROL_ALLOW_HEADERS = 'access-control-allow-headers',
    AUTHORIZATION = 'authorization',
    CACHE_CONTROL = 'cache-control',
    CONTENT_LENGTH = 'content-length',
    CONTENT_TYPE = 'content-type',
    CONTENT_DISPOSITION = 'content-disposition',
    CONTENT_SECURITY_POLICY = 'content-security-policy',
    COOKIE = 'cookie',
    HOST = 'host',
    STRICT_TRANSPORT_SECURITY = 'strict-transport-security',
    ORIGIN = 'origin',
    REFERER = 'referer',
    REFERRER_POLICY = 'referrer-policy',
    USER_AGENT = 'user-agent',
    X_FRAME_OPTIONS = 'x-frame-options',
    X_CONTENT_TYPE_OPTIONS = 'x-content-type-options',
    X_REQUESTED_WITH = 'x-requested-with',
    X_FORWARDED_FOR = 'x-forwarded-for',
    X_FORWARDED_HOST = 'x-forwarded-host',
    X_FORWARDED_PROTO = 'x-forwarded-proto',
    X_REAL_IP = 'x-real-ip',
    X_VERSION = 'x-version',
    IF_NONE_MATCH = 'if-none-match',
    IIF_MODIFIED_SINCE = 'if-modified-since',
    CONNECTION = 'connection',
    DNT = 'dnt',
    SEC_FETCH_MODE = 'sec-fetch-mode',
    SEC_FETCH_SITE = 'sec-fetch-site',
    TE = 'te'
}

/**
 * Checks if the given value is a known header.
 * @param value - The value to check.
 * @returns True when the KnownHeader enum values include the given value, false otherwise.
 */
export function isKnownHeader(value: string): value is KnownHeader {
    return ObjectUtilities.values(KnownHeader).includes(value.toLowerCase() as KnownHeader);
}