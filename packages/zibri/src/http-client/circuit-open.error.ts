import { HttpClientError } from './http-client.error';
import { HttpMethod } from '../http/http-method.enum';

/**
 * Thrown by the http client for a request it did not send, because the origin it goes to failed too
 * often in a row.
 */
export class CircuitOpenError extends HttpClientError {
    /**
     * The origin the request was for, eg. 'https://api.example.com'.
     */
    readonly origin: string;
    /**
     * When the next request to the origin is let through.
     */
    readonly reopensAt: Date;

    constructor(origin: string, reopensAt: Date, method: HttpMethod, url: string) {
        super(
            `Not sending ${method} ${url}: ${origin} failed too often in a row,`
            + ` the next request goes through at ${reopensAt.toISOString()}`,
            { responseData: undefined, requestData: { method, url, body: undefined, headers: {} } }
        );
        this.name = 'CircuitOpenError';
        this.origin = origin;
        this.reopensAt = reopensAt;
    }
}