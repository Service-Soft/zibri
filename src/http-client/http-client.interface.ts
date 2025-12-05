import { HttpClientResponseForBodyType } from './http-client-response.model';
import { KnownHeader, MimeType } from '../http';
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
    BodyType extends BodyMetadata['type']
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
    responseBody: Newable<T> | OmitStrict<BodyMetadataInput, 'type'> & {
        /**
         * The type of the response.
         */
        type: BodyType,
        /**
         * The class that defines the structure of the body.
         */
        modelClass: Newable<T>
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
    BodyType extends BodyMetadata['type'] = MimeType.JSON
> = Partial<HttpOptions<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType>>;

/**
 * Interface for a http client.
 */
export interface HttpClientInterface {
    /**
     * Sends a http post request.
     */
    post: <
        T extends object,
        QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue> = Partial<Record<KnownHeader, HttpClientHeaderValue>>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput> = Record<string, HeaderParamMetadataInput>,
        BodyType extends BodyMetadata['type'] = MimeType.JSON
    >(
        url: string,
        body: unknown,
        options?: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType>
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType
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
        BodyType extends BodyMetadata['type'] = MimeType.JSON
    >(
        url: string,
        options?: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType>
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType
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
        BodyType extends BodyMetadata['type'] = MimeType.JSON
    >(
        url: string,
        body: unknown,
        options?: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType>
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType
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
        BodyType extends BodyMetadata['type'] = MimeType.JSON
    >(
        url: string,
        body: unknown,
        options?: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType>
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType
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
        BodyType extends BodyMetadata['type'] = MimeType.JSON
    >(
        url: string,
        options?: HttpOptionsInput<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, BodyType>
    ) => Promise<
        HttpClientResponseForBodyType<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            BodyType
        >
    >
}