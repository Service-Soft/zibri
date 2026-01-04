import { HttpClientResponseForBodyType } from './http-client-response.model';
import { HttpMethod, KnownHeader, MimeType } from '../http';
import { BodyMetadata, BodyMetadataInput, HeaderMetaInputObjectToMetaObject, HeaderMetaObjectToParamsObject, HeaderParamMetadataInput } from '../routing';
import { Newable, OmitStrict } from '../types';

/**
 * Possible values to send as headers when using the http client.
 */
export type HttpClientHeaderValue = string | string[] | number | boolean | undefined;

/**
 * Options for sending a http request with the client.
 */
type HttpOptions<
    T extends object,
    QueryParamsObject extends Record<string, unknown>,
    HeaderParamsObject extends Record<string, HttpClientHeaderValue>,
    ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>,
    BodyType extends BodyMetadata['type'],
    IsArray extends boolean
> = {
    /**
     * The query parameters of the request, as an object.
     */
    query: QueryParamsObject,
    /**
     * The header parameters of the request, as an object.
     */
    headers: HeaderParamsObject,
    /**
     * The timeout for the request in ms.
     */
    timeoutMs: number,
    /**
     * The amount of times that the request should be retried before finally failing.
     */
    retries: number,
    /**
     * Definition on how the response body should look like. Can either be a class that defines the structure of the body or a full body metadata definition.
     *
     * THIS ALSO ACTUALLY VALIDATES THE RESPONSE.
     */
    responseBody: Newable<T> | OmitStrict<BodyMetadataInput, 'type' | 'isArray'> & {
        /**
         * The type of the response.
         */
        type: BodyType,
        /**
         * The class that defines the structure of the body.
         */
        modelClass: Newable<T>,
        /**
         * Whether or not the response is an array.
         */
        isArray?: IsArray
    },
    /**
     * Definition of the expected response headers. Also handles validating them.
     */
    responseHeaders: ResponseHeaderMetaInputObject
};

/**
 * Input for creating http options.
 */
export type HttpOptionsInput<
    T extends object,
    QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
    HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
    ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
    BodyType extends BodyMetadata['type'] = MimeType.JSON,
    IsArray extends boolean = false
> = Partial<HttpOptions<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray>>;

/**
 * Interface for a http client.
 */
export interface HttpClientInterface {
    /**
     * Sends a request with the given data.
     */
    request: <
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
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        >
    >,
    /**
     * Sends a http post request.
     */
    post: <
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        BodyType extends BodyMetadata['type'] = MimeType.JSON,
        IsArray extends boolean = false
    >(
        url: string,
        body: unknown,
        options?: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray>
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        >
    >,
    /**
     * Sends a http get request.
     */
    get: <
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        BodyType extends BodyMetadata['type'] = MimeType.JSON,
        IsArray extends boolean = false
    >(
        url: string,
        options?: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray>
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        >
    >,
    /**
     * Sends a http put request.
     */
    put: <
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        BodyType extends BodyMetadata['type'] = MimeType.JSON,
        IsArray extends boolean = false
    >(
        url: string,
        body: unknown,
        options?: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray>
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        >
    >,
    /**
     * Sends a http patch request.
     */
    patch: <
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        BodyType extends BodyMetadata['type'] = MimeType.JSON,
        IsArray extends boolean = false
    >(
        url: string,
        body: unknown,
        options?: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray>
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        >
    >,
    /**
     * Sends a http delete request.
     */
    delete: <
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        BodyType extends BodyMetadata['type'] = MimeType.JSON,
        IsArray extends boolean = false
    >(
        url: string,
        options?: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType, IsArray>
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType,
            IsArray
        >
    >
}