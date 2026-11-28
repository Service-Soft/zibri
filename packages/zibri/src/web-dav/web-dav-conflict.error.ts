import { HttpClientError } from '../http-client/http-client.error';

/**
 * Thrown by a `WebDavClient` for a request that conflicts with what is on the server, most often a put, a new
 * folder or a move into a folder that does not exist, or a folder where a file is. The server answered
 * `409 Conflict`, or a new folder was asked for where a file is.
 */
export class WebDavConflictError extends HttpClientError {
    /**
     * Creates the error for the answer the server refused the request with.
     * @param path - The path that was to be written, relative to the connection: the destination of a move.
     * @param cause - The error of the http client for the answer.
     */
    constructor(readonly path: string, cause: HttpClientError) {
        super(
            `The WebDAV server refused to write "${path}" as a conflict, such as with a folder above it that does not exist.`,
            { responseData: cause.responseData, requestData: cause.requestData },
            { cause }
        );
        this.name = 'WebDavConflictError';
    }
}
