/**
 * The methods of WebDAV (RFC 4918), CalDAV (RFC 4791) and WebDAV SEARCH (RFC 5323) that the http client sends besides
 * an `HttpMethod`.
 *
 * Apart from `HttpMethod`, so that a route or a path of the open api cannot be declared with one: only the
 * http client takes them.
 */
export enum WebDavMethod {
    PROPFIND = 'PROPFIND',
    MKCOL = 'MKCOL',
    COPY = 'COPY',
    MOVE = 'MOVE',
    REPORT = 'REPORT',
    SEARCH = 'SEARCH'
}
