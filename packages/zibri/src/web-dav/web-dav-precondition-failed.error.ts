import { HttpClientError } from '../http-client/http-client.error';

/**
 * Thrown by a `WebDavClient` for a request whose condition does not hold: a put under `ifMatch` of a file that was
 * changed since, or that does not exist, a put under `ifNoneMatch` of a file that exists, or a move without
 * `overwrite` to a destination that exists. The server answered `412 Precondition Failed`.
 */
export class WebDavPreconditionFailedError extends HttpClientError {
    /**
     * Creates the error for the answer the server refused the request with.
     * @param path - The path the condition was about, relative to the connection: the destination of a move.
     * @param cause - The error of the http client for the answer.
     */
    constructor(readonly path: string, cause: HttpClientError) {
        super(
            `The WebDAV server refused the request for "${path}": what is there is not what the request was conditioned on.`,
            { responseData: cause.responseData, requestData: cause.requestData },
            { cause }
        );
        this.name = 'WebDavPreconditionFailedError';
    }
}
