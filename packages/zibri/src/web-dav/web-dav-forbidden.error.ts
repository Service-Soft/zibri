import { HttpClientError } from '../http-client/http-client.error';

/**
 * Thrown by a `WebDavClient` for a request the user of the connection may not make, such as a write to a folder
 * shared with them to read. The server answered `403 Forbidden`.
 */
export class WebDavForbiddenError extends HttpClientError {
    /**
     * Creates the error for the answer the server refused the request with.
     * @param path - The path the request was for, relative to the connection.
     * @param cause - The error of the http client for the answer.
     */
    constructor(readonly path: string, cause: HttpClientError) {
        super(
            `The WebDAV server forbids the request for "${path}".`,
            { responseData: cause.responseData, requestData: cause.requestData },
            { cause }
        );
        this.name = 'WebDavForbiddenError';
    }
}