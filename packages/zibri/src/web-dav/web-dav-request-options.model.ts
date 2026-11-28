/**
 * What every request of a `WebDavClient` is sent with, for a class building on it that sends requests of its own
 * to the same server, such as to an api of the server beside WebDAV.
 */
export type WebDavRequestOptions = {
    /**
     * The credentials of the connection, as the `authorization` header.
     */
    headers: Record<string, string>,
    /**
     * How long the request may take, or undefined for the timeout of the http client.
     */
    timeoutInMs: number | undefined,
    /**
     * How often it is attempted, or undefined for once.
     */
    attempts: number | undefined,
    /**
     * What checks where a redirect leads, for a connection of a tenant, or undefined for one of the application.
     */
    validateRedirect: ((to: URL) => Promise<void>) | undefined
};