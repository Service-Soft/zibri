/**
 * All known http methods.
 *
 * Spelled the way the protocol spells them, which is also how node reports the method of an incoming
 * request - so `request.method` is one of these without anything having to convert it. The two places
 * that need the lowercase form ask for it there: express registers handlers under a lowercase name,
 * and an open api path item is keyed by one.
 */
export enum HttpMethod {
    GET = 'GET',
    HEAD = 'HEAD',
    POST = 'POST',
    PUT = 'PUT',
    PATCH = 'PATCH',
    DELETE = 'DELETE',
    OPTIONS = 'OPTIONS',
    TRACE = 'TRACE'
}

/**
 * The name express and open api know a method by.
 * @param method - The method to spell.
 * @returns Its lowercase name.
 */
export function httpMethodKey(method: HttpMethod): Lowercase<HttpMethod> {
    return method.toLowerCase() as Lowercase<HttpMethod>;
}