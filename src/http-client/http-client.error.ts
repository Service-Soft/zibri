import { HttpClientResponse } from './http-client-response.model';
import { HttpMethod } from '../http/http-method.enum';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * Data of the http request that was sent.
 */
export type HttpClientErrorRequestData = {
    /**
     * The request method.
     */
    method: HttpMethod,
    /**
     * The body of the request.
     */
    body: unknown,
    /**
     * The headers of the request.
     */
    headers: Record<string, unknown>,
    /**
     * The full url of the request.
     */
    url: string
};

/**
 * Data of the http response that was received.
 */
export type HttpClientErrorResponseData = OmitStrict<HttpClientResponse<unknown, Record<string, unknown>>, 'rawBody'>;

/**
 * Options for creating a http client error.
 */
export type HttpClientErrorOptions = {
    /**
     * The data of the response, if one could be received.
     */
    responseData: HttpClientErrorResponseData | undefined,
    /**
     * The data of the request, if one could be made.
     */
    requestData: HttpClientErrorRequestData | undefined
};

/**
 * Error that is thrown when a request from the http client didn't work.
 */
export class HttpClientError extends Error {
    /**
     * The data of the response, if one could be received.
     */
    readonly responseData?: HttpClientErrorResponseData;
    /**
     * The data of the request, if one could be made.
     */
    readonly requestData?: HttpClientErrorRequestData;

    constructor(message: string, data: HttpClientErrorOptions, options?: ErrorOptions | undefined) {
        super(getErrorMessage(message, data), options);
        this.name = 'HttpClientError';
        this.responseData = data.responseData;
        this.requestData = data.requestData;

        Object.defineProperty(this, 'message', { enumerable: true });
    }
}

/**
 * Check whether or not the given value is a http client error.
 * @param value - The value to check.
 * @returns True when the values name is 'HttpClientError', false otherwise.
 */
export function isHttpClientError(value: unknown): value is HttpClientError {
    return typeof value === 'object' && value != undefined && 'name' in value && value.name === 'HttpClientError';
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getErrorMessage(message: string, data: HttpClientErrorOptions): string {
    if (!data.responseData) {
        if (data.requestData) {
            return `No response received for ${data.requestData.method.toUpperCase()} ${data.requestData.url}:\n${message}`;
        }
        return `Could not send the request:\n${message}`;
    }

    if (!data.requestData) {
        return `Could not send the request:\n${message}`;
    }

    const fullUrl: string = `${data.requestData.method.toUpperCase()} ${data.requestData.url}`;

    return `Request ${fullUrl} failed with ${data.responseData.status} ${data.responseData.statusText}`;
}