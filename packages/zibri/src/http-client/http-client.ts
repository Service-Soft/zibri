import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { HttpClientResponse, HttpClientResponseForBodyType } from './http-client-response.model';
import { HttpClientError, HttpClientErrorOptions } from './http-client.error';
import { HttpClientHeaderValue, HttpClientInterface, HttpOptionsInput, RequestBodyMimeType } from './http-client.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { InternalError } from '../error-handling/internal-error.model';
import { HttpMethod } from '../http/http-method.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { warn } from '../logging/logger.helpers';
import { type ParserInterface } from '../parsing/parser.interface';
import { BodyMetadata, resolveMaxBodySize } from '../routing/decorators/body.decorator';
import { HeaderParamMetadata, HeaderParamMetadataInput } from '../routing/decorators/param.decorator';
import { createHeaderParamMetadata } from '../routing/param-metdata.helpers';
import { HeaderMetaObjectToParamsObject, HeaderMetaInputObjectToMetaObject } from '../routing/route-configuration.model';
import { Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { Ms } from '../utilities/ms';
import { ObjectUtilities } from '../utilities/object.utilities';
import { type ValidationServiceInterface } from '../validation/validation-service.interface';

// eslint-disable-next-line jsdoc/require-jsdoc
type ResponseType = 'json' | 'stream';

const responseTypeForMimeType: Record<BodyMetadata['type'], ResponseType> = {
    [MimeType.JSON]: 'json',
    // [MimeType.XML]: 'text',
    // [MimeType.HTML]: 'text',
    // [MimeType.TXT]: 'text',
    [MimeType.FORM_DATA]: 'stream'
    // [MimeType.FORM_URL_ENCODED]: 'text',
    // [MimeType.OCTET_STREAM]: 'stream',
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
function isRequestBodyMimeType(value: string): value is RequestBodyMimeType {
    return value === MimeType.JSON
        || value === MimeType.FORM_URL_ENCODED
        || value === MimeType.FORM_DATA
        || value === MimeType.OCTET_STREAM;
}

// eslint-disable-next-line jsdoc/require-jsdoc
type RequestBodySerialization = 'json' | 'raw';

const requestBodySerializationForMimeType: Record<RequestBodyMimeType, RequestBodySerialization> = {
    [MimeType.JSON]: 'json',
    [MimeType.FORM_URL_ENCODED]: 'raw',
    [MimeType.FORM_DATA]: 'raw',
    [MimeType.OCTET_STREAM]: 'raw'
};

/**
 * Default http client implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class HttpClient implements HttpClientInterface {

    constructor(
        @Inject(ZIBRI_DI_TOKENS.PARSER)
        private readonly parser: ParserInterface,
        @Inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE)
        private readonly validationService: ValidationServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async post<
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        BodyType extends BodyMetadata['type'] = MimeType.JSON,
        IsArray extends boolean = false
    >(
        url: string,
        body: unknown,
        options: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray> = {}
    ): Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
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
        BodyType extends BodyMetadata['type'] = MimeType.JSON,
        IsArray extends boolean = false
    >(
        url: string,
        options: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray> = {}
    ): Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
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
        BodyType extends BodyMetadata['type'] = MimeType.JSON,
        IsArray extends boolean = false
    >(
        url: string,
        body: unknown,
        options: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray> = {}
    ): Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
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
        BodyType extends BodyMetadata['type'] = MimeType.JSON,
        IsArray extends boolean = false
    >(
        url: string,
        body: unknown,
        options: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray> = {}
    ): Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
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
        BodyType extends BodyMetadata['type'] = MimeType.JSON,
        IsArray extends boolean = false
    >(
        url: string,
        options: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray> = {}
    ): Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        >
    > {
        return await this.request(HttpMethod.DELETE, url, undefined, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, sonar/cognitive-complexity
    async request<
        T extends object,
        QueryParamsObject extends Record<string, unknown>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>,
        BodyType extends BodyMetadata['type'],
        IsArray extends boolean
    >(
        method: HttpMethod,
        url: string,
        requestBody: unknown,
        options: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray> | undefined
    ): Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        >
    > {
        if ([HttpMethod.HEAD, HttpMethod.OPTIONS, HttpMethod.TRACE].includes(method)) {
            throw new InternalError('Not implemented yet.');
        }

        const queryString: string | undefined = options?.query
            ? new URLSearchParams(
                ObjectUtilities.entries(options.query)
                    .filter(([, v]) => v != undefined)
                    .map(([k, v]) => [k, String(v)])
            ).toString()
            : undefined;
        const urlWithParams: string = queryString ? `${url}?${queryString}` : url;

        const init: RequestInit = this.buildRequestInit(method, requestBody, options?.headers, options?.requestBodyType);

        let fetchResponse: Response | undefined;
        let error: unknown;

        for (let i: number = 0; i < (options?.attempts ?? 1); i++) {
            if (fetchResponse != undefined) {
                continue;
            }
            try {
                const response: Response = await this.sendRequest(urlWithParams, init, options?.timeoutMs ?? Ms.SECOND * 5);
                if (!response.ok) {
                    throw await this.buildResponseError(response, method, url, requestBody, options?.headers);
                }
                fetchResponse = response;
            }
            catch (_error) {
                error = _error;
            }
        }

        if (!fetchResponse) {
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

        const responseHeaders: Record<string, string> = Object.fromEntries(fetchResponse.headers.entries());
        let bodyReader: ResponseType = 'json';
        if (options?.responseBody && 'modelClass' in options.responseBody && options.responseBody.type != undefined) {
            bodyReader = responseTypeForMimeType[options.responseBody.type] ?? 'json';
        }
        const rawBody: unknown = await this.readBody(fetchResponse, bodyReader);

        const res: HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        > = {
            rawBody,
            body: undefined as unknown as T,
            status: fetchResponse.status,
            statusText: fetchResponse.statusText,
            headers: responseHeaders
        } as HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        >;

        if (!options?.responseBody) {
            return res;
        }

        const modelClass: Newable<T> = 'modelClass' in options.responseBody ? options.responseBody.modelClass : options.responseBody;
        const metadata: BodyMetadata = {
            index: 0,
            required: true,
            description: undefined,
            type: MimeType.JSON,
            cleanupAfterMs: Ms.DAY,
            modelClass,
            isArray: false,
            maxSize: resolveMaxBodySize(modelClass, ('modelClass' in options.responseBody ? options.responseBody : {}).baseMaxSize),
            ...'modelClass' in options.responseBody ? options.responseBody : {}
        } as BodyMetadata;

        let responseBody: unknown;
        try {
            responseBody = await this.parser.parseBody(res as unknown as HttpClientResponse, metadata);
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
            await this.validationService.validateBody(responseBody, metadata);
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
            ObjectUtilities.keys(options.responseHeaders ?? {}).map(async (key) => {
                // eslint-disable-next-line typescript/no-non-null-assertion
                const headerMetadata: HeaderParamMetadata = createHeaderParamMetadata(key, options.responseHeaders![key]);
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

    private buildRequestInit(
        method: HttpMethod,
        body: unknown,
        headers?: Record<string, HttpClientHeaderValue>,
        requestBodyType: RequestBodyMimeType = this.resolveContentTypeHeader(headers, body)
    ): RequestInit {
        const init: RequestInit = {
            // fetch requires the canonical uppercase HTTP method token, unlike our lowercase HttpMethod enum values.
            method: method.toUpperCase(),
            headers: headers as Record<string, string> | undefined
        };

        if (body == undefined) {
            return init;
        }

        const isPreEncoded: boolean = body instanceof FormData || body instanceof Blob
            || body instanceof ArrayBuffer || body instanceof ReadableStream;
        const serialization: RequestBodySerialization = requestBodySerializationForMimeType[requestBodyType];

        if (serialization === 'json' && isPreEncoded) {
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
    private resolveContentTypeHeader(headers: Record<string, HttpClientHeaderValue> | undefined, body: unknown): RequestBodyMimeType {
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

    private async sendRequest(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
        const controller: AbortController = new AbortController();
        const timeout: NodeJS.Timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...init, signal: controller.signal });
        }
        finally {
            clearTimeout(timeout);
        }
    }

    private async readBody(response: Response, reader: ResponseType): Promise<unknown> {
        switch (reader) {
            case 'json': {
                // A successful response can still have an empty body (eg. 204 No Content), which
                // response.json() cannot parse — treat that as "no body" instead of throwing.
                const text: string = await response.text();
                return text.length ? JsonUtilities.parse(text) : undefined;
            }
            case 'stream': {
                if (!response.body) {
                    throw new InternalError('Response has no body stream');
                }
                return Readable.fromWeb(response.body as NodeReadableStream);
            }
        }
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