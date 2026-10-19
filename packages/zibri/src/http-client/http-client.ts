import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { setTimeout as wait } from 'node:timers/promises';

import { CircuitBreaker } from './circuit-breaker.model';
import { CircuitOpenError } from './circuit-open.error';
import { FetchForLibraryOptions } from './fetch-for-library-options.model';
import { HttpClientIdempotencyKey } from './http-client-idempotency-key.model';
import { type HttpClientDispatcher, type HttpClientOptions } from './http-client-options.model';
import { HttpClientResponse, HttpClientResponseBodyInput, HttpClientResponseForBody } from './http-client-response.model';
import { HttpClientError, HttpClientErrorOptions } from './http-client.error';
import { HttpClientHeaderValue, HttpClientInterface, HttpOptionsInput, HttpClientRequestBody, HttpClientRequestBodyMimeType } from './http-client.interface';
import { AlsUtilities } from '../context/als.utilities';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { fileSizeToBytes } from '../entity/models/file-property-metadata.model';
import { ContentTooLargeError } from '../error-handling/errors/content-too-large.error';
import { InternalError } from '../error-handling/internal-error.model';
import { HttpMethod } from '../http/http-method.enum';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { warn } from '../logging/logger.helpers';
import { type ParserInterface } from '../parsing/parser.interface';
import { BodyMetadata } from '../routing/decorators/body-metadata.model';
import { resolveMaxBodySize } from '../routing/decorators/body.decorator';
import { HeaderParamMetadata, HeaderParamMetadataInput } from '../routing/decorators/param.decorator';
import { createHeaderParamMetadata } from '../routing/param-metdata.helpers';
import { resolveBodyMetadata } from '../routing/resolve-body-metadata.function';
import { HeaderMetaObjectToParamsObject, HeaderMetaInputObjectToMetaObject } from '../routing/route-configuration.model';
import { TraceContextUtilities } from '../tracing/trace-context.utilities';
import { TraceSpanContext } from '../tracing/trace-span-context.model';
import { TraceSpanKind } from '../tracing/trace-span-kind.enum';
import { TraceSpanInterface } from '../tracing/trace-span.interface';
import { TracingUtilities } from '../tracing/tracing.utilities';
import { isNewable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { Ms } from '../utilities/ms';
import { BigNumber, NumberUtilities } from '../utilities/number.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { type ValidationServiceInterface } from '../validation/validation-service.interface';

// eslint-disable-next-line jsdoc/require-jsdoc
type ResponseType = 'json' | 'xml' | 'text' | 'stream';

/**
 * A request that is on its way, and the means to end the deadline it was sent under.
 */
type SentRequest = {
    /**
     * The response, whose headers have arrived and whose body may not have.
     */
    response: Response,
    /**
     * Ends the deadline. Called once the answer has been read, or given up on.
     */
    release: () => void
};

/**
 * What `fetch` is actually called with.
 *
 * `dispatcher` is undici's own addition to `RequestInit` rather than part of the fetch standard,
 * which is why the DOM lib does not know about it - node's `fetch` is undici's and reads it.
 */
type DispatchedRequestInit = RequestInit & {
    /**
     * What to send the request over, or absent for node's own.
     */
    dispatcher?: HttpClientDispatcher
};

/**
 * The methods a request can be repeated with, because sending one twice says the same thing as
 * sending it once.
 *
 * PUT and DELETE are on the list even though they change something: repeating them lands the resource
 * in the state the first attempt asked for, which is what idempotent means. POST and PATCH are not,
 * and are the reason this list exists at all - a second `POST /payments` is a second payment.
 */
const idempotentMethods: HttpMethod[] = [HttpMethod.GET, HttpMethod.HEAD, HttpMethod.OPTIONS, HttpMethod.PUT, HttpMethod.DELETE];

/**
 * Statuses that describe a condition another attempt could find gone.
 *
 * Everything else a server answers with is its considered opinion about this request, and asking
 * again produces the same opinion - a 400 is still malformed, a 409 is still a conflict, a 403 is
 * still forbidden.
 */
const retryableStatuses: number[] = [
    HttpStatus.REQUEST_TIMEOUT,
    HttpStatus.TOO_MANY_REQUESTS,
    HttpStatus.INTERNAL_SERVER_ERROR,
    HttpStatus.BAD_GATEWAY,
    HttpStatus.SERVICE_UNAVAILABLE,
    HttpStatus.GATEWAY_TIMEOUT
];

/**
 * Statuses a server uses to say it has not done the work yet.
 *
 * The one case where repeating a non-idempotent request is safe: the answer is not about the request
 * at all, it is the server declining to look at it. A 429 counted it and refused; a 503 was not
 * accepting work. Neither can have charged a card.
 */
const notYetProcessedStatuses: number[] = [HttpStatus.TOO_MANY_REQUESTS, HttpStatus.SERVICE_UNAVAILABLE];

/**
 * Statuses that count toward opening the circuit of the origin that answered them.
 *
 * The ones that say the origin itself is not working. A 429 is left out: the origin is working, and
 * says when to come back with `Retry-After`.
 */
const originFailureStatuses: number[] = [
    HttpStatus.INTERNAL_SERVER_ERROR,
    HttpStatus.BAD_GATEWAY,
    HttpStatus.SERVICE_UNAVAILABLE,
    HttpStatus.GATEWAY_TIMEOUT
];

/**
 * How long the first wait between attempts is, before doubling.
 */
const baseRetryDelayMs: number = 250;

/**
 * The longest this will wait between two attempts, however many have failed.
 */
const maxRetryDelayMs: number = 10 * Ms.SECOND;

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
 * Checks whether the given value is a mime type that HttpClient knows how to build a request body for.
 * @param value - The value to check.
 * @returns Whether the value is a supported request body mime type.
 */
function isRequestBodyMimeType(value: string): value is HttpClientRequestBodyMimeType {
    return value === MimeType.JSON
        || value === MimeType.XML
        || value === MimeType.FORM_URL_ENCODED
        || value === MimeType.FORM_DATA
        || value === MimeType.OCTET_STREAM;
}

// eslint-disable-next-line jsdoc/require-jsdoc
type RequestBodySerialization = 'json' | 'xml' | 'raw';

const requestBodySerializationForMimeType: Record<HttpClientRequestBodyMimeType, RequestBodySerialization> = {
    [MimeType.JSON]: 'json',
    [MimeType.XML]: 'xml',
    [MimeType.FORM_URL_ENCODED]: 'raw',
    [MimeType.FORM_DATA]: 'raw',
    [MimeType.OCTET_STREAM]: 'raw'
};

/**
 * Default http client implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class HttpClient implements HttpClientInterface {
    /**
     * The circuits of the origins this client sends to, or undefined when the application turned
     * the breaker off.
     */
    private readonly circuitBreaker: CircuitBreaker | undefined;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.PARSER)
        private readonly parser: ParserInterface,
        @Inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE)
        private readonly validationService: ValidationServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS)
        private readonly clientOptions: HttpClientOptions
    ) {
        this.circuitBreaker = clientOptions.circuitBreaker === false ? undefined : new CircuitBreaker(clientOptions.circuitBreaker);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async post<
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        IsArray extends boolean = false,
        ResponseBody extends HttpClientResponseBodyInput<T, IsArray> = never,
        RequestBodyType extends HttpClientRequestBodyMimeType = HttpClientRequestBodyMimeType
    >(
        url: string,
        body: NoInfer<HttpClientRequestBody<RequestBodyType>>,
        options?: HttpOptionsInput<
            T,
            QueryParamsObject,
            HeaderParamsObject,
            ResponseHeaderMetaInputObject,
            IsArray,
            ResponseBody,
            RequestBodyType
        >
    ): Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
            IsArray
        >
    > {
        return await this.request(HttpMethod.POST, url, body, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get<
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        IsArray extends boolean = false,
        ResponseBody extends HttpClientResponseBodyInput<T, IsArray> = never
    >(
        url: string,
        options?: HttpOptionsInput<
            T,
            QueryParamsObject,
            HeaderParamsObject,
            ResponseHeaderMetaInputObject,
            IsArray,
            ResponseBody
        >
    ): Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
            IsArray
        >
    > {
        return await this.request(HttpMethod.GET, url, undefined, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async put<
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        IsArray extends boolean = false,
        ResponseBody extends HttpClientResponseBodyInput<T, IsArray> = never,
        RequestBodyType extends HttpClientRequestBodyMimeType = HttpClientRequestBodyMimeType
    >(
        url: string,
        body: NoInfer<HttpClientRequestBody<RequestBodyType>>,
        options?: HttpOptionsInput<
            T,
            QueryParamsObject,
            HeaderParamsObject,
            ResponseHeaderMetaInputObject,
            IsArray,
            ResponseBody,
            RequestBodyType
        >
    ): Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
            IsArray
        >
    > {
        return await this.request(HttpMethod.PUT, url, body, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async patch<
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        IsArray extends boolean = false,
        ResponseBody extends HttpClientResponseBodyInput<T, IsArray> = never,
        RequestBodyType extends HttpClientRequestBodyMimeType = HttpClientRequestBodyMimeType
    >(
        url: string,
        body: NoInfer<HttpClientRequestBody<RequestBodyType>>,
        options?: HttpOptionsInput<
            T,
            QueryParamsObject,
            HeaderParamsObject,
            ResponseHeaderMetaInputObject,
            IsArray,
            ResponseBody,
            RequestBodyType
        >
    ): Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
            IsArray
        >
    > {
        return await this.request(HttpMethod.PATCH, url, body, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete<
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        IsArray extends boolean = false,
        ResponseBody extends HttpClientResponseBodyInput<T, IsArray> = never
    >(
        url: string,
        options?: HttpOptionsInput<
            T,
            QueryParamsObject,
            HeaderParamsObject,
            ResponseHeaderMetaInputObject,
            IsArray,
            ResponseBody
        >
    ): Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
            IsArray
        >
    > {
        return await this.request(HttpMethod.DELETE, url, undefined, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async request<
        T extends object,
        QueryParamsObject extends Record<string, unknown>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>,
        IsArray extends boolean,
        ResponseBody extends HttpClientResponseBodyInput<T, IsArray> = never
    >(
        method: HttpMethod,
        url: string,
        requestBody: unknown,
        options: HttpOptionsInput<
            T,
            QueryParamsObject,
            HeaderParamsObject,
            ResponseHeaderMetaInputObject,
            IsArray,
            ResponseBody
        > | undefined
    ): Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
            IsArray
        >
    > {
        if ([HttpMethod.HEAD, HttpMethod.OPTIONS, HttpMethod.TRACE].includes(method)) {
            throw new InternalError('Not implemented yet.');
        }

        // around the whole call rather than around the fetch: the headers a request goes out with
        // are built inside, and what they have to carry is this span. Retries are attempts at one
        // call and belong to one span, which is what the resend count says
        return await TracingUtilities.trace(
            method,
            {
                kind: TraceSpanKind.CLIENT,
                attributes: {
                    'http.request.method': method,
                    // without the query string, which is where a token or an email address ends up
                    // - a span is kept for as long as the backend keeps it and read by everyone who
                    // can read traces
                    'url.full': url,
                    'server.address': this.findHost(url)
                }
            },
            async span => await this.sendTracedRequest(method, url, requestBody, options, span)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async fetchForLibrary(url: string, init: RequestInit, options?: FetchForLibraryOptions): Promise<Response> {
        const requested: string = (init.method ?? HttpMethod.GET).toUpperCase();
        const method: HttpMethod | undefined = Object.values(HttpMethod).find(m => m === requested);
        if (method == undefined) {
            throw new InternalError(`The http client cannot send a request with the method "${init.method}".`);
        }
        return await TracingUtilities.trace(
            method,
            {
                kind: TraceSpanKind.CLIENT,
                attributes: { 'http.request.method': method, 'url.full': url, 'server.address': this.findHost(url) }
            },
            async span => {
                const headers: Headers = new Headers(init.headers);
                for (const [name, value] of Object.entries(this.withTraceContext(Object.fromEntries(headers.entries())) ?? {})) {
                    headers.set(name, value);
                }
                const requestSignal: AbortSignal | undefined = AlsUtilities.findCurrentRequestSignal();
                // the library's own signal as well as the request's: a library passing one expects it to
                // end the call, and the deadline of the request this runs inside still applies
                const signals: AbortSignal[] = [init.signal, requestSignal].filter(s => s != undefined);
                const sent: SentRequest = await this.sendRequest(
                    method,
                    url,
                    { ...init, headers },
                    this.clientOptions.defaultTimeoutMs,
                    this.clientOptions.dispatcher,
                    signals.length ? AbortSignal.any(signals) : undefined
                );
                try {
                    // read here rather than handed over as a stream, so the deadline and the size limit
                    // cover the body the same way they do for every other call
                    const body: Uint8Array<ArrayBuffer> = await this.readBytesWithin(
                        sent.response,
                        fileSizeToBytes(options?.maxResponseSize ?? this.clientOptions.defaultMaxResponseSize)
                    ).catch((error: unknown) => {
                        throw this.buildReadError(sent.response, method, url, init.body, Object.fromEntries(headers.entries()), error);
                    });
                    span.recordAttributes({ 'http.response.status_code': sent.response.status });
                    return new Response(body.byteLength ? body : undefined, {
                        status: sent.response.status,
                        statusText: sent.response.statusText,
                        headers: sent.response.headers
                    });
                }
                finally {
                    sent.release();
                }
            }
        );
    }

    /**
     * Everything one call does, with a span to record what it turned out to be.
     * @param method - The http method.
     * @param url - What is being asked for.
     * @param requestBody - What is being sent, if anything.
     * @param options - What the caller asked for.
     * @param span - The span of this call.
     * @returns The response.
     */
    // eslint-disable-next-line sonar/cognitive-complexity
    private async sendTracedRequest<
        T extends object,
        QueryParamsObject extends Record<string, unknown>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>,
        IsArray extends boolean,
        ResponseBody extends HttpClientResponseBodyInput<T, IsArray> = never
    >(
        method: HttpMethod,
        url: string,
        requestBody: unknown,
        options: HttpOptionsInput<
            T,
            QueryParamsObject,
            HeaderParamsObject,
            ResponseHeaderMetaInputObject,
            IsArray,
            ResponseBody
        > | undefined,
        span: TraceSpanInterface
    ): Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
            IsArray
        >
    > {
        const queryString: string | undefined = options?.query
            ? new URLSearchParams(
                ObjectUtilities.entries(options.query)
                    .filter(([, v]) => v != undefined)
                    .map(([k, v]) => [k, String(v)])
            ).toString()
            : undefined;
        const urlWithParams: string = queryString ? `${url}?${queryString}` : url;

        // resolved once for the call rather than per attempt: a key that changed between attempts
        // would tell the server each one is a new request, which is the opposite of what it is for
        const idempotencyHeader: [string, string] | undefined = this.resolveIdempotencyHeader(options?.idempotencyKey);
        const headers: Record<string, HttpClientHeaderValue> | undefined = idempotencyHeader == undefined
            ? options?.headers
            : { ...options?.headers, [idempotencyHeader[0]]: idempotencyHeader[1] };
        const init: RequestInit = this.buildRequestInit(method, requestBody, headers, options?.requestBodyType);

        // resolved before anything is sent, so that a declaration that cannot work is refused without a request
        const responseBodyMetadata: BodyMetadata | undefined = options?.responseBody
            ? resolveBodyMetadata(isNewable(options.responseBody) ? { modelClass: options.responseBody } : options.responseBody, 0)
            : undefined;
        const bodyReader: ResponseType = responseTypeForMimeType[responseBodyMetadata?.type ?? MimeType.JSON];
        // a declared response body is the size of the thing that was asked for, the same way a route's body
        // is. Without one there is nothing to derive a size from, so the deployment's ceiling applies
        const maxBodySize: BigNumber = this.resolveMaxResponseSize(responseBodyMetadata);

        let fetchResponse: Response | undefined;
        let rawBody: unknown;
        let error: unknown;

        // read once, because a request that is answered while this is retrying should stop retrying.
        // Not an option a call passes: a deadline is a fact about the request this runs inside, and
        // asking every call site to thread it down is asking for the ones that forget
        const requestSignal: AbortSignal | undefined = AlsUtilities.findCurrentRequestSignal();

        const attempts: number = options?.attempts ?? 1;
        let resendCount: number = 0;
        for (let attempt: number = 1; attempt <= attempts; attempt++) {
            if (requestSignal?.aborted === true) {
                // the caller has been answered without this, so there is nothing to send it to.
                // Thrown rather than returned, because there is no response to hand back
                throw requestSignal.reason;
            }
            resendCount = attempt - 1;
            // held open until the body has been read rather than until the headers arrive: the
            // deadline is for the answer, and an answer whose first line came back instantly and
            // whose body never finishes is exactly the case a timeout exists to end
            let release: (() => void) | undefined;
            try {
                const sent: SentRequest = await this.sendRequest(
                    method,
                    urlWithParams,
                    init,
                    options?.timeoutMs ?? this.clientOptions.defaultTimeoutMs,
                    // the request's own replaces the application's rather than merging with it: a
                    // dispatcher is one connection policy, and half of two is not a policy
                    options?.dispatcher ?? this.clientOptions.dispatcher,
                    requestSignal
                );
                release = sent.release;
                if (!sent.response.ok) {
                    throw await this.buildResponseError(sent.response, method, url, requestBody, options?.headers);
                }
                // a streamed body belongs to whoever consumes it, so the deadline cannot cover it -
                // it is read after this call has already returned
                rawBody = bodyReader === 'stream'
                    ? await this.readBody(sent.response, bodyReader, maxBodySize)
                    : await this.readBodyWithin(sent.response, bodyReader, maxBodySize, method, url, requestBody, options?.headers);
                fetchResponse = sent.response;
                break;
            }
            catch (_error) {
                error = _error;
            }
            finally {
                release?.();
            }

            if (attempt === attempts) {
                break;
            }
            const delayMs: number | undefined = this.retryDelayFor(method, idempotencyHeader != undefined, error, attempt);
            if (delayMs == undefined) {
                break;
            }
            // the signal ends the wait as well as the request: backing off for ten seconds before
            // resending something nobody is waiting for is the longest part of the waste
            await wait(delayMs, undefined, { signal: requestSignal }).catch(() => undefined);
        }

        if (!fetchResponse) {
            // reported as what it was rather than as a failed request. Nothing went wrong with this
            // call - it was let go because the request that asked for it had already been answered,
            // and saying "could not get a response" would put a second story on top of the first
            if (requestSignal?.aborted === true) {
                throw requestSignal.reason;
            }
            if (error instanceof HttpClientError) {
                throw error;
            }
            throw new HttpClientError(
                'Could not get a response',
                {
                    responseData: undefined,
                    requestData: { method, url, body: requestBody, headers: {} }
                },
                { cause: error }
            );
        }

        span.recordAttributes({
            'http.response.status_code': fetchResponse.status,
            // absent rather than zero when the call went out once, which is what the convention asks
            // for - a resend is the exception and a span carrying the attribute is the one to look at
            'http.request.resend_count': resendCount === 0 ? undefined : resendCount
        });

        const responseHeaders: Record<string, string> = Object.fromEntries(fetchResponse.headers.entries());

        const res: HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
            IsArray
        > = {
            rawBody,
            body: undefined as unknown as T,
            status: fetchResponse.status,
            statusText: fetchResponse.statusText,
            headers: responseHeaders
        } as HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
            IsArray
        >;

        if (!responseBodyMetadata || !options?.responseBody) {
            return res;
        }

        let responseBody: unknown;
        try {
            responseBody = await this.parser.parseBody(res as unknown as HttpClientResponse, responseBodyMetadata);
        }
        catch (error) {
            throw new HttpClientError(
                'Could not parse response body',
                {
                    responseData: { body: res.rawBody, status: res.status, statusText: res.statusText, headers: responseHeaders },
                    requestData: { method, url, body: requestBody, headers: options?.headers as Record<string, unknown> ?? {} }
                },
                { cause: error }
            );
        }

        try {
            await this.validationService.validateBody(responseBody, responseBodyMetadata);
        }
        catch (error) {
            throw new HttpClientError(
                'Could not validate response body',
                {
                    responseData: { body: res.rawBody, status: res.status, statusText: res.statusText, headers: responseHeaders },
                    requestData: { method, url, body: requestBody, headers: options?.headers as Record<string, unknown> ?? {} }
                },
                { cause: error }
            );
        }

        await Promise.all(
            ObjectUtilities.entries(options.responseHeaders ?? {}).map(async ([key, header]) => {
                const headerMetadata: HeaderParamMetadata = createHeaderParamMetadata(key, header);
                try {
                    (res.headers[key] as unknown) = this.parser.parseHeaderParam(
                        res as unknown as HttpClientResponse,
                        headerMetadata
                    );
                }
                catch (error) {
                    throw new HttpClientError(
                        `Could not parse response header "${headerMetadata.name}"`,
                        {
                            responseData: { body: res.rawBody, status: res.status, statusText: res.statusText, headers: responseHeaders },
                            requestData: { method, url, body: requestBody, headers: options?.headers as Record<string, unknown> ?? {} }
                        },
                        { cause: error }
                    );
                }

                try {
                    await this.validationService.validateHeaderParam(res.headers[key], headerMetadata);
                }
                catch (error) {
                    throw new HttpClientError(
                        `Could not validate response header "${headerMetadata.name}"`,
                        {
                            responseData: { body: res.rawBody, status: res.status, statusText: res.statusText, headers: responseHeaders },
                            requestData: { method, url, body: requestBody, headers: options?.headers as Record<string, unknown> ?? {} }
                        },
                        { cause: error }
                    );
                }
            })
        );

        return { ...res, body: responseBody };
    }

    /**
     * Passes the trace the caller is in on to the request being made.
     *
     * What makes a trace worth having: without it a call fanning out to three services produces four
     * sets of logs that nothing joins, which is exactly the moment somebody needs them joined. A
     * caller that set the header itself is left alone - it knows something this does not.
     *
     * A call made where no trace was established - a script, a test reaching for the client directly
     * - sends none, so the service on the other end starts one.
     * @param headers - The headers the caller asked for, if any.
     * @returns The headers to send.
     */
    /**
     * The most a response body may weigh.
     * @param metadata - The response body the call declared, if any.
     * @returns The size the declared body allows, or the deployment's ceiling without one.
     */
    private resolveMaxResponseSize(metadata: BodyMetadata | undefined): BigNumber {
        if (metadata == undefined) {
            return fileSizeToBytes(this.clientOptions.defaultMaxResponseSize);
        }
        return metadata.type === MimeType.OCTET_STREAM ? metadata.maxSize : resolveMaxBodySize(metadata);
    }

    /**
     * The host a call is going to, for a span to say who it was talking to.
     *
     * Parsed rather than split, because a url that does not parse is one this is not going to learn
     * anything from - and a span that cannot name the host is still a span worth having.
     * @param url - What is being asked for.
     * @returns The host, or undefined when the url is relative or unreadable.
     */
    private findHost(url: string): string | undefined {
        try {
            return new URL(url).host;
        }
        catch {
            return undefined;
        }
    }

    /**
     * The origin a call is going to, which its circuit is kept under.
     * @param url - What is being asked for.
     * @returns The origin, or undefined when the url does not parse, which fetch refuses anyway.
     */
    private findOrigin(url: string): string | undefined {
        try {
            return new URL(url).origin;
        }
        catch {
            return undefined;
        }
    }

    /**
     * The header an idempotency key is sent as, and the key.
     * @param key - What the call asked for, if anything.
     * @returns The header name and the key, or undefined when the call asked for none.
     */
    private resolveIdempotencyHeader(key: HttpClientIdempotencyKey | undefined): [string, string] | undefined {
        if (key == undefined) {
            return undefined;
        }
        if (key === true) {
            return [KnownHeader.IDEMPOTENCY_KEY, UUIDUtilities.generate()];
        }
        if (typeof key === 'string') {
            return [KnownHeader.IDEMPOTENCY_KEY, key];
        }
        return [key.header ?? KnownHeader.IDEMPOTENCY_KEY, key.value ?? UUIDUtilities.generate()];
    }

    private withTraceContext(headers: Record<string, HttpClientHeaderValue> | undefined): Record<string, string> | undefined {
        const context: TraceSpanContext | undefined = TracingUtilities.getCurrentTraceContext();

        if (context == undefined || headers?.[KnownHeader.TRACEPARENT] != undefined) {
            return headers as Record<string, string> | undefined;
        }
        return { ...headers as Record<string, string> | undefined, ...TraceContextUtilities.resolveHeaders(context) };
    }

    private buildRequestInit(
        method: HttpMethod,
        body: unknown,
        headers?: Record<string, HttpClientHeaderValue>,
        requestBodyType: HttpClientRequestBodyMimeType = this.resolveContentTypeHeader(headers, body)
    ): RequestInit {
        const init: RequestInit = {
            // fetch requires the canonical uppercase HTTP method token, unlike our lowercase HttpMethod enum values.
            method: method.toUpperCase(),
            headers: this.withTraceContext(headers)
        };

        if (body == undefined) {
            return init;
        }

        const isPreEncoded: boolean = body instanceof FormData || body instanceof Blob
            || body instanceof ArrayBuffer || body instanceof ReadableStream;
        const serialization: RequestBodySerialization = requestBodySerializationForMimeType[requestBodyType];

        if ((serialization === 'json' || serialization === 'xml') && isPreEncoded) {
            throw new InternalError(`Cannot send a ${(body as object).constructor.name} body with request body type "${requestBodyType}".`);
        }
        if (serialization === 'raw' && typeof body !== 'string' && !isPreEncoded) {
            throw new InternalError(`Cannot send a plain object body with request body type "${requestBodyType}".`);
        }

        // fetch sets FormData's Content-Type itself (including the multipart boundary) — setting it
        // manually here would strip that boundary and break parsing on the receiving end.
        if (!(body instanceof FormData) && headers?.[KnownHeader.CONTENT_TYPE] == undefined) {
            const initHeaders: Headers = new Headers(init.headers);
            initHeaders.set(KnownHeader.CONTENT_TYPE, requestBodyType);
            init.headers = Object.fromEntries(initHeaders.entries());
        }

        switch (serialization) {
            case 'json': {
                init.body = JsonUtilities.stringify(body);
                break;
            }
            case 'xml': {
                // an XmlString, which only the compiler can tell from other text. A body that is not text
                // at all got here past it, eg. from javascript
                if (typeof body !== 'string') {
                    throw new InternalError('An xml body is sent as an XmlString, eg. one written with XmlUtilities.generateFrom.');
                }
                init.body = body;
                break;
            }
            case 'raw': {
                init.body = body as BodyInit;
                break;
            }
        }

        return init;
    }

    /**
     * Resolves the mime type that a request body should be sent as.
     * Prefers an explicit Content-Type header, then infers one from the body's runtime type, defaulting to JSON.
     * @param headers - The headers to resolve the mime type from if KnownHeader.CONTENT_TYPE is set.
     * @param body - The body to resolve the mime type from.
     * @returns The resolved mime type.
     */
    private resolveContentTypeHeader(
        headers: Record<string, HttpClientHeaderValue> | undefined,
        body: unknown
    ): HttpClientRequestBodyMimeType {
        const headerValue: HttpClientHeaderValue = headers?.[KnownHeader.CONTENT_TYPE];
        if (headerValue != undefined) {
            const mimeType: string = headerValue.toString();
            if (!isRequestBodyMimeType(mimeType)) {
                warn(`Unsupported request body mime type "${mimeType}", defaults to MimeType.JSON`);
                return MimeType.JSON;
            }
            return mimeType;
        }

        if (body instanceof FormData) {
            return MimeType.FORM_DATA;
        }
        if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof ReadableStream) {
            return MimeType.OCTET_STREAM;
        }
        return MimeType.JSON;
    }

    /**
     * How long to wait before attempting this request again, or undefined when it must not be.
     *
     * Two questions, and both have to say yes. **Is the failure worth another attempt** - a status the
     * server will answer identically next time is not, so everything outside
     * {@link retryableStatuses} stops here. **Is repeating this request safe** - which depends on the
     * method, because a second `POST /payments` is a second payment.
     *
     * A non-idempotent request is repeated in exactly one case: the server said it had not looked at
     * it yet. A 429 counted the request and refused it, a 503 was not accepting work, and neither can
     * have charged anything. A network error or a timeout is the opposite situation and is never
     * repeated for those methods - the request may well have arrived and been carried out, with only
     * the answer lost, and there is no way from here to tell that from a request that never landed.
     * Unless it carries an idempotency key: then the server answers a repeat like the first, and the
     * request is as safe to repeat as a PUT.
     * @param method - The method the request was sent with.
     * @param hasIdempotencyKey - Whether the request carries an idempotency key.
     * @param error - What the attempt failed with.
     * @param attempt - Which attempt just failed, counting from one.
     * @returns The delay before the next attempt, or undefined to stop.
     */
    private retryDelayFor(method: HttpMethod, hasIdempotencyKey: boolean, error: unknown, attempt: number): number | undefined {
        // not sent at all, and nothing changes before the circuit lets one through
        if (error instanceof CircuitOpenError) {
            return undefined;
        }
        const status: number | undefined = error instanceof HttpClientError ? error.responseData?.status : undefined;

        if (status != undefined && !retryableStatuses.includes(status)) {
            return undefined;
        }
        const repeatable: boolean = hasIdempotencyKey || idempotentMethods.includes(method);
        if (!repeatable && (status == undefined || !notYetProcessedStatuses.includes(status))) {
            return undefined;
        }

        const retryAfterMs: number | undefined = this.retryAfterMs(error);
        if (retryAfterMs != undefined) {
            // the server named a time, so waiting less is asking to be refused again and waiting a
            // different amount is second-guessing the only party that knows
            return retryAfterMs;
        }

        // doubling, so a service that is down is asked progressively less often. Half the window is
        // fixed and half is random: the random half is what stops a burst of callers that all failed
        // together from all coming back together and repeating the pileup, and the fixed half is what
        // keeps the backoff from rolling a delay so short that it never backed off at all
        const window: number = Math.min(baseRetryDelayMs * (2 ** (attempt - 1)), maxRetryDelayMs);
        return Math.round((window / 2) + (Math.random() * (window / 2)));
    }

    /**
     * Reads how long a server asked to be left alone for.
     * @param error - What the attempt failed with.
     * @returns The delay in milliseconds, or undefined when no usable one was given.
     */
    private retryAfterMs(error: unknown): number | undefined {
        if (!(error instanceof HttpClientError)) {
            return undefined;
        }
        const header: unknown = error.responseData?.headers?.[KnownHeader.RETRY_AFTER];
        if (typeof header !== 'string' && typeof header !== 'number') {
            return undefined;
        }

        // the header is either a number of seconds or an http date, and both forms are in the wild
        const seconds: number = Number(header);
        if (!Number.isNaN(seconds)) {
            return Math.max(0, seconds * Ms.SECOND);
        }
        const date: number = Date.parse(String(header));
        if (Number.isNaN(date)) {
            return undefined;
        }
        return Math.max(0, date - Date.now());
    }

    /**
     * Sends the request, handing back the means to end its deadline.
     *
     * The deadline is not released here, because `fetch` resolves when the *headers* arrive and the
     * body is still to come. Releasing at that point is what left a response that dribbles, or stops
     * halfway, with nothing to end it - the timeout had already been cleared. The caller releases once
     * it has what it came for.
     *
     * Sent only while the circuit of the url's origin lets it through, and its outcome recorded there.
     * @param method - The method the request is sent with, for the error when it is not sent.
     * @param url - The url to request.
     * @param init - The request to send.
     * @param timeoutMs - How long the whole answer may take.
     * @param dispatcher - What to send it over, or undefined for node's own.
     * @param requestSignal - The deadline of the request this is being sent for, if there is one.
     * @returns The response, and the release for its deadline.
     * @throws A CircuitOpenError without sending anything while the origin's circuit is open.
     */
    private async sendRequest(
        method: HttpMethod,
        url: string,
        init: RequestInit,
        timeoutMs: number,
        dispatcher: HttpClientDispatcher | undefined,
        requestSignal: AbortSignal | undefined
    ): Promise<SentRequest> {
        const origin: string | undefined = this.circuitBreaker == undefined ? undefined : this.findOrigin(url);
        if (origin != undefined) {
            const reopensAt: Date | undefined = this.circuitBreaker?.admit(origin);
            if (reopensAt != undefined) {
                throw new CircuitOpenError(origin, reopensAt, method, url);
            }
        }
        const sent: SentRequest = await this.sendThroughDeadline(url, init, timeoutMs, dispatcher, requestSignal)
            .catch((error: unknown) => {
                if (origin != undefined) {
                    // the request this was sent for being answered says nothing about the origin;
                    // anything else that left it without an answer - refused, reset, timed out - does
                    if (requestSignal?.aborted === true) {
                        this.circuitBreaker?.recordNeither(origin);
                    }
                    else {
                        this.circuitBreaker?.recordFailure(origin);
                    }
                }
                throw error;
            });
        if (origin != undefined) {
            if (originFailureStatuses.includes(sent.response.status)) {
                this.circuitBreaker?.recordFailure(origin);
            }
            else {
                this.circuitBreaker?.recordAnswer(origin);
            }
        }
        return sent;
    }

    /**
     * Sends the request under its deadline, handing back the means to end it.
     * @param url - The url to request.
     * @param init - The request to send.
     * @param timeoutMs - How long the whole answer may take.
     * @param dispatcher - What to send it over, or undefined for node's own.
     * @param requestSignal - The deadline of the request this is being sent for, if there is one.
     * @returns The response, and the release for its deadline.
     */
    private async sendThroughDeadline(
        url: string,
        init: RequestInit,
        timeoutMs: number,
        dispatcher: HttpClientDispatcher | undefined,
        requestSignal: AbortSignal | undefined
    ): Promise<SentRequest> {
        const controller: AbortController = new AbortController();
        const timeout: NodeJS.Timeout = setTimeout(() => controller.abort(), timeoutMs);
        // whichever of the two comes first, which is the only sensible reading of having both: a
        // call may not outlive its own timeout, and it may not outlive the request that asked for it
        const signal: AbortSignal = requestSignal
            ? AbortSignal.any([controller.signal, requestSignal])
            : controller.signal;
        const release: () => void = () => clearTimeout(timeout);
        try {
            // omitted entirely when there is none, so an unconfigured client sends exactly what a
            // plain fetch would
            const request: DispatchedRequestInit = dispatcher
                ? { ...init, signal, dispatcher }
                : { ...init, signal };
            return { response: await fetch(url, request), release };
        }
        catch (error) {
            release();
            throw error;
        }
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
    private async readBodyWithin(
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
    private buildReadError(
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

    private async readBody(response: Response, reader: ResponseType, maxSize: BigNumber): Promise<unknown> {
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
     * Reads a response body as text, giving up as soon as it is longer than allowed.
     *
     * Counted while it arrives rather than afterwards, which is the whole point: `response.text()`
     * commits the memory first, leaving the limit to be enforced on a string already in the heap - a
     * five gigabyte answer would be downloaded in full only to be refused for being too large. Reading
     * it chunk by chunk means the transfer is stopped at the limit instead of at the end, and peak
     * memory is bounded by what was asked for rather than by what the upstream chose to send.
     *
     * The same shape the server side uses for an incoming request body.
     * @param response - The response to read.
     * @param maxSize - The most this may buffer.
     * @returns The body as text.
     * @throws ContentTooLargeError when the body is larger than allowed.
     */
    private async readTextWithin(response: Response, maxSize: BigNumber): Promise<string> {
        return new TextDecoder().decode(await this.readBytesWithin(response, maxSize));
    }

    /**
     * Reads a response body, giving up as soon as it is longer than allowed - for the reason
     * `readTextWithin` gives.
     * @param response - The response to read.
     * @param maxSize - The most this may buffer.
     * @returns The body.
     * @throws ContentTooLargeError when the body is larger than allowed.
     */
    private async readBytesWithin(response: Response, maxSize: BigNumber): Promise<Uint8Array<ArrayBuffer>> {
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
                // cancels the underlying source, so the rest of the answer is never transferred
                await response.body.cancel();
                throw new ContentTooLargeError();
            }
            chunks.push(chunk);
        }

        return Buffer.concat(chunks);
    }

    private async buildResponseError(
        response: Response,
        method: HttpMethod,
        url: string,
        requestBody: unknown,
        requestHeaders?: Record<string, HttpClientHeaderValue>
    ): Promise<HttpClientError> {
        // Read the body once as text: response.json() consumes the body stream even when parsing
        // fails, which would make a subsequent response.text() throw "Body has already been read".
        let responseBody: unknown;
        const rawText: string = await response.text();
        try {
            responseBody = JsonUtilities.parse(rawText);
        }
        catch {
            responseBody = rawText;
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

        return new HttpClientError(this.getErrorMessage(response.statusText, options), options);
    }

    private getErrorMessage(message: string, data: HttpClientErrorOptions): string {
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
}