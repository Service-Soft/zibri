import { HttpClientError } from '../http-client/http-client.error';

/**
 * Thrown by a `WebDavClient` for a path that holds nothing, or a move whose source does not exist: the server
 * answered `404 Not Found`.
 */
export class WebDavNotFoundError extends HttpClientError {
    /**
     * Creates the error for the answer the server refused the request with.
     * @param path - The path that holds nothing, relative to the connection.
     * @param cause - The error of the http client for the answer.
     */
    constructor(readonly path: string, cause: HttpClientError) {
        super(
            `The WebDAV server holds nothing at "${path}".`,
            { responseData: cause.responseData, requestData: cause.requestData },
            { cause }
        );
        this.name = 'WebDavNotFoundError';
    }
}
