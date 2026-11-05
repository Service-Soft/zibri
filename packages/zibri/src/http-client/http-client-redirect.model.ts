/**
 * What the http client does when a request is answered with a redirect.
 *
 * - `'follow'` follows it, up to 20 in a row, unless it leads from https to http.
 * - `'same-origin'` follows it only to the origin (scheme, host and port) it came from.
 * - `'error'` follows none.
 *
 * A redirect that is not followed fails the request with an `HttpClientError` carrying its status
 * and its `Location`. A redirect that leaves the origin is sent on without the `Authorization`,
 * `Proxy-Authorization` and `Cookie` headers.
 */
export type HttpClientRedirect = 'follow' | 'same-origin' | 'error';