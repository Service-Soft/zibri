import axios, { AxiosInstance, AxiosResponse, RawAxiosRequestConfig, ResponseType } from 'axios';

import { HttpClientResponse, HttpClientResponseForBodyType } from './http-client-response.model';
import { HttpClientHeaderValue, HttpClientInterface, HttpOptionsInput } from './http-client.interface';
import { Inject, ZIBRI_DI_TOKENS } from '../di';
import { HttpMethod } from '../http/http-method.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { type ParserInterface } from '../parsing/parser.interface';
import { BodyMetadata, HeaderMetaInputObjectToMetaObject, HeaderMetaObjectToParamsObject, HeaderParamMetadata, HeaderParamMetadataInput, resolveMaxBodySize } from '../routing';
import { createHeaderParamMetadata } from '../routing/param-metdata.helpers';
import { Newable } from '../types';
import { Ms } from '../utilities';
import { type ValidationServiceInterface } from '../validation/validation-service.interface';

const responseTypeForMimeType: Record<MimeType, ResponseType> = {
    [MimeType.JSON]: 'json',
    [MimeType.XML]: 'text',
    [MimeType.HTML]: 'text',
    [MimeType.TXT]: 'text',
    [MimeType.FORM_DATA]: 'stream',
    [MimeType.OCTET_STREAM]: 'stream',
    [MimeType.PNG]: 'stream',
    [MimeType.JPEG]: 'stream',
    [MimeType.ZIP]: 'stream',
    [MimeType.SVG]: 'stream',
    [MimeType.CSS]: 'stream',
    [MimeType.TTF]: 'stream',
    [MimeType.PDF]: 'stream',
    [MimeType.CSV]: 'stream',
    [MimeType.XLSX]: 'stream',
    [MimeType.DOCX]: 'stream'
};

/**
 * Default http client implementation of Zibri.
 */
export class HttpClient implements HttpClientInterface {
    private readonly axios: AxiosInstance;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.PARSER)
        private readonly parser: ParserInterface,
        @Inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE)
        private readonly validationService: ValidationServiceInterface
    ) {
        this.axios = axios.create();
    }

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
        const config: RawAxiosRequestConfig<unknown> = {
            timeout: options?.timeoutMs,
            headers: options?.headers,
            params: options?.query
        };
        if (options?.responseBody && 'modelClass' in options.responseBody && options.responseBody.type != undefined) {
            config.responseType = responseTypeForMimeType[options.responseBody.type];
        }

        let axiosResponse: AxiosResponse<unknown> | undefined = undefined;
        let error: unknown = undefined;

        for (let i: number = 0; i < (options?.retries ?? 1); i++) {
            if (axiosResponse != undefined) {
                continue;
            }
            try {
                switch (method) {
                    case HttpMethod.POST: {
                        axiosResponse = await this.axios.post(url, requestBody, config);
                        break;
                    }
                    case HttpMethod.GET: {
                        axiosResponse = await this.axios.get(url, config);
                        break;
                    }
                    case HttpMethod.PUT: {
                        axiosResponse = await this.axios.put(url, requestBody, config);
                        break;
                    }
                    case HttpMethod.PATCH: {
                        axiosResponse = await this.axios.patch(url, requestBody, config);
                        break;
                    }
                    case HttpMethod.DELETE: {
                        axiosResponse = await this.axios.delete(url, config);
                        break;
                    }
                    case HttpMethod.HEAD:
                    case HttpMethod.OPTIONS:
                    case HttpMethod.TRACE: {
                        throw new Error('Not implemented yet.');
                    }
                }
            }
            catch (error_) {
                error = error_;
            }
        }

        if (!axiosResponse) {
            throw error instanceof Error ? error : new Error('Could not get a response');
        }

        const res: HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        > = {
            rawBody: axiosResponse.data,
            body: undefined as unknown as T,
            status: axiosResponse.status,
            statusText: axiosResponse.statusText,
            headers: axiosResponse.headers as HeaderParamsObject
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

        const responseBody: unknown = await this.parser.parseBody(res as unknown as HttpClientResponse, metadata);
        this.validationService.validateBody(responseBody, metadata);

        for (const key in options.responseHeaders) {
            const headerMetadata: HeaderParamMetadata = createHeaderParamMetadata(key, options.responseHeaders[key]);
            (res.headers[key] as unknown) = this.parser.parseHeaderParam(
                res as unknown as HttpClientResponse,
                headerMetadata
            );
            this.validationService.validateHeaderParam(res.headers[key], headerMetadata);
        }

        return { ...res, body: responseBody };
    }
}