import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { HttpClientError, HttpClientErrorOptions } from './http-client.error';
import { HttpClientHeaderValue } from './http-client.interface';
import { ContentTooLargeError } from '../error-handling/errors/content-too-large.error';
import { InternalError } from '../error-handling/internal-error.model';
import { HttpMethod } from '../http/http-method.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { BodyMetadata } from '../routing/decorators/body-metadata.model';
import { JsonUtilities } from '../utilities/json.utilities';
import { BigNumber, NumberUtilities } from '../utilities/number.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
type ResponseType = 'json' | 'xml' | 'text' | 'stream';

/**
 * How much of a failed response's body the message of its error quotes. The error carries all of it.
 */
const ERROR_MESSAGE_BODY_LENGTH: number = 500;

const responseTypeForMimeType: Record<BodyMetadata['type'], ResponseType> = {
    [MimeType.JSON]: 'json',
    [MimeType.JSON_LD]: 'json',
    [MimeType.JSON_SCIM]: 'json',
    [MimeType.XML]: 'xml',
    // [MimeType.HTML]: 'text',
    // [MimeType.TXT]: 'text',
    [MimeType.FORM_DATA]: 'stream',
    [MimeType.FORM_URL_ENCODED]: 'text',
    [MimeType.OCTET_STREAM]: 'stream'
    // [MimeType.PNG]: 'stream',
    // [MimeType.JPEG]: 'stream',
    // [MimeType.ZIP]: 'stream',
    // [MimeType.SVG]: 'stream',
    // [MimeType.CSS]: 'stream',
    // [MimeType.TTF]: 'stream',
    // [MimeType.PDF]: 'stream',
    // [MimeType.CSV]: 'stream',
    // [MimeType.XLSX]: 'stream',
    // [MimeType.DOCX]: 'stream'
};

/**
 * Reads the bodies of the responses the http client gets, and builds the errors for the ones it
 * refuses.
 */
export abstract class HttpClientBodyUtilities {
    /**
     * Reads the body of a response the way the body a call declared is read: as JSON, as text, or as
     * a stream that is handed over unread.
     * @param response - The response to read.
     * @param metadata - The response body the call declared, if any. JSON without one.
     * @param maxSize - The most this may buffer.
     * @param method - The method the request was sent with, for the error.
     * @param url - The url that was requested, for the error.
     * @param requestBody - The body that was sent, for the error.
     * @param requestHeaders - The headers that were sent, for the error.
     * @returns The body.
     * @throws When the body could not be read, or was larger than allowed.
     */
    static async readResponseBody(
        response: Response,
        metadata: BodyMetadata | undefined,
        maxSize: BigNumber,
        method: HttpMethod,
        url: string,
        requestBody: unknown,
        requestHeaders?: Record<string, HttpClientHeaderValue>
    ): Promise<unknown> {
        const reader: ResponseType = responseTypeForMimeType[metadata?.type ?? MimeType.JSON];
        // a streamed body belongs to whoever consumes it, so the deadline cannot cover it - it is
        // read after the call has already returned
        return reader === 'stream'
            ? await this.readBody(response, reader, maxSize)
            : await this.readBodyWithin(response, reader, maxSize, method, url, requestBody, requestHeaders);
    }

    /**
     * Reads a response body, giving up as soon as it is longer than allowed.
     * @param response - The response to read.
     * @param maxSize - The most this may buffer.
     * @returns The body.
     * @throws ContentTooLargeError when the body is larger than allowed.
     */
    static async readBytesWithin(response: Response, maxSize: BigNumber): Promise<Uint8Array<ArrayBuffer>> {
        // counted while it arrives rather than afterwards, which is the whole point: `response.text()`
        // commits the memory first, leaving the limit to be enforced on a string already in the heap -
        // a five gigabyte answer would be downloaded in full only to be refused for being too large.
        // Reading it chunk by chunk means the transfer is stopped at the limit instead of at the end,
        // and peak memory is bounded by what was asked for rather than by what the upstream chose to
        // send. The same shape the server side uses for an incoming request body
        const contentLength: string | null = response.headers.get(KnownHeader.CONTENT_LENGTH);
        // an upstream that declares a length over the limit is refused before a byte of body is read.
        // It is free to lie or to say nothing, which is why the count below still happens
        if (contentLength != undefined && NumberUtilities.new(Number(contentLength)).isGreaterThan(maxSize)) {
            throw new ContentTooLargeError();
        }
        if (!response.body) {
            return new Uint8Array();
        }

        let received: BigNumber = NumberUtilities.new(0);
        const chunks: Uint8Array[] = [];

        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            received = NumberUtilities.add(received, chunk.byteLength);
            if (received.isGreaterThan(maxSize)) {
                // leaving the loop cancels the underlying source, so the rest of the answer is never
                // transferred. Not cancelled by hand: the loop holds the stream locked, and a cancel
                // on a locked stream is refused
                throw new ContentTooLargeError();
            }
            chunks.push(chunk);
        }

        return Buffer.concat(chunks);
    }

    /**
     * Builds the error for a response body that could not be read.
     * @param response - The response whose body could not be read.
     * @param method - The method the request was sent with.
     * @param url - The url that was requested.
     * @param requestBody - The body that was sent.
     * @param requestHeaders - The headers that were sent.
     * @param cause - Why the body could not be read.
     * @returns The error.
     */
    static buildReadError(
        response: Response,
        method: HttpMethod,
        url: string,
        requestBody: unknown,
        requestHeaders: Record<string, HttpClientHeaderValue> | undefined,
        cause: unknown
    ): HttpClientError {
        return new HttpClientError(
            'Could not read the response body',
            {
                responseData: {
                    body: undefined,
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries())
                },
                requestData: { method, url, body: requestBody, headers: requestHeaders as Record<string, unknown> ?? {} }
            },
            { cause }
        );
    }

    /**
     * Builds the error for a response the call does not accept, with the body the upstream sent.
     * @param response - The response.
     * @param maxSize - The most of its body that is read. A larger body is left out of the error.
     * @param method - The method the request was sent with.
     * @param url - The url that was requested.
     * @param requestBody - The body that was sent.
     * @param requestHeaders - The headers that were sent.
     * @param message - The message of the error, or one naming the request and the status.
     * @returns The error.
     */
    static async buildResponseError(
        response: Response,
        maxSize: BigNumber,
        method: HttpMethod,
        url: string,
        requestBody: unknown,
        requestHeaders?: Record<string, HttpClientHeaderValue>,
        message?: string
    ): Promise<HttpClientError> {
        // Read the body once as text: response.json() consumes the body stream even when parsing
        // fails, which would make a subsequent response.text() throw "Body has already been read".
        // Counted against the deployment's ceiling rather than the limit the call's declared body
        // allows: a failure's body is whatever the upstream or a proxy in front of it chose to send,
        // and the ceiling is the memory the deployment is willing to spend on one answer
        let responseBody: unknown;
        let rawText: string = '';
        try {
            rawText = await this.readTextWithin(response, maxSize);
            try {
                responseBody = JsonUtilities.parse(rawText);
            }
            catch {
                responseBody = rawText;
            }
        }
        catch (error) {
            if (!(error instanceof ContentTooLargeError)) {
                throw error;
            }
            // the status is what a caller, a retry and the circuit breaker act on; a body past the
            // ceiling is left out rather than turning a 502 into a size error
            responseBody = undefined;
        }

        const options: HttpClientErrorOptions = {
            responseData: {
                body: responseBody,
                headers: Object.fromEntries(response.headers.entries()),
                status: response.status,
                statusText: response.statusText
            },
            requestData: {
                method,
                url,
                body: requestBody,
                headers: requestHeaders as Record<string, unknown> ?? {}
            }
        };

        // the body is where an upstream says why, and the message is all a log line or a test report
        // shows of the error: a refused capture read "failed with 422 Unknown Error", with the reason on
        // `responseData` where nothing printed it
        const statusLine: string = this.getErrorMessage(response.statusText, options);
        const excerpt: string = rawText.length > ERROR_MESSAGE_BODY_LENGTH ? `${rawText.slice(0, ERROR_MESSAGE_BODY_LENGTH)}…` : rawText;
        return new HttpClientError(message ?? (excerpt ? `${statusLine}:\n${excerpt}` : statusLine), options);
    }

    /**
     * Reads a response body, reporting anything that goes wrong as a client error.
     * @param response - The response to read.
     * @param reader - How to read it.
     * @param maxSize - The most this may buffer.
     * @param method - The method the request was sent with, for the error.
     * @param url - The url that was requested, for the error.
     * @param requestBody - The body that was sent, for the error.
     * @param requestHeaders - The headers that were sent, for the error.
     * @returns The body.
     * @throws When the body could not be read, or was larger than allowed.
     */
    private static async readBodyWithin(
        response: Response,
        reader: ResponseType,
        maxSize: BigNumber,
        method: HttpMethod,
        url: string,
        requestBody: unknown,
        requestHeaders?: Record<string, HttpClientHeaderValue>
    ): Promise<unknown> {
        try {
            return await this.readBody(response, reader, maxSize);
        }
        catch (error) {
            throw this.buildReadError(response, method, url, requestBody, requestHeaders, error);
        }
    }

    private static async readBody(response: Response, reader: ResponseType, maxSize: BigNumber): Promise<unknown> {
        switch (reader) {
            case 'json': {
                // A successful response can still have an empty body (eg. 204 No Content), which
                // response.json() cannot parse — treat that as "no body" instead of throwing.
                const text: string = await this.readTextWithin(response, maxSize);
                return text.length ? JsonUtilities.parse(text) : undefined;
            }
            case 'xml':
            case 'text': {
                // kept as text: xml and a form only become data against the model they are read
                // into, which is the body parser's job
                const text: string = await this.readTextWithin(response, maxSize);
                return text.length ? text : undefined;
            }
            case 'stream': {
                if (!response.body) {
                    throw new InternalError('Response has no body stream');
                }
                return Readable.fromWeb(response.body as NodeReadableStream);
            }
        }
    }

    /**
     * Reads a response body as text, giving up as soon as it is longer than allowed, for the reason
     * `readBytesWithin` gives.
     * @param response - The response to read.
     * @param maxSize - The most this may buffer.
     * @returns The body as text.
     * @throws ContentTooLargeError when the body is larger than allowed.
     */
    private static async readTextWithin(response: Response, maxSize: BigNumber): Promise<string> {
        return new TextDecoder().decode(await this.readBytesWithin(response, maxSize));
    }

    private static getErrorMessage(message: string, data: HttpClientErrorOptions): string {
        if (!data.responseData) {
            return data.requestData
                ? `No response received for ${data.requestData.method.toUpperCase()} ${data.requestData.url}:\n${message}`
                : `Could not send the request:\n${message}`;
        }

        if (!data.requestData) {
            return `Could not send the request:\n${message}`;
        }

        const fullUrl: string = `${data.requestData.method.toUpperCase()} ${data.requestData.url}`;

        return `Request ${fullUrl} failed with ${data.responseData.status} ${data.responseData.statusText}`;
    }
}