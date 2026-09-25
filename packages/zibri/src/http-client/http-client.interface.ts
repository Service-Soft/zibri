import { HttpClientDispatcher } from './http-client-options.model';
import { HttpClientResponseBodyInput, HttpClientResponseForBody } from './http-client-response.model';
import { XmlString } from '../document/xml-string.type';
import { HttpMethod } from '../http/http-method.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { HeaderParamMetadataInput } from '../routing/decorators/param.decorator';
import { HeaderMetaObjectToParamsObject, HeaderMetaInputObjectToMetaObject } from '../routing/route-configuration.model';
import { Newable } from '../types/newable.type';

/**
 * Possible values to send as headers when using the http client.
 */
export type HttpClientHeaderValue = string | string[] | number | boolean | undefined;

/**
 * Mime types that HttpClient knows how to build a request body for.
 */
export type HttpClientRequestBodyMimeType = MimeType.JSON
    | MimeType.XML
    | MimeType.FORM_URL_ENCODED
    | MimeType.FORM_DATA
    | MimeType.OCTET_STREAM;

/**
 * What a request body is for the mime type it is sent as: a well formed document for xml, like one written with
 * `XmlUtilities.generateFrom`, and whatever the client can send for anything else.
 */
export type HttpClientRequestBody<RequestBodyType extends HttpClientRequestBodyMimeType> = RequestBodyType extends MimeType.XML
    ? XmlString
    : unknown;

/**
 * Options for sending a http request with the client.
 */
type HttpOptions<
    T extends object,
    QueryParamsObject extends Record<string, unknown>,
    HeaderParamsObject extends Record<string, HttpClientHeaderValue>,
    ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>,
    IsArray extends boolean,
    ResponseBody extends HttpClientResponseBodyInput<T, IsArray>,
    RequestBodyType extends HttpClientRequestBodyMimeType
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
     * The amount of times that the request should be attempted before finally failing.
     * Defaults to 1.
     */
    attempts: number,
    /**
     * What this one request is sent over, replacing whatever the application configured.
     *
     * For the destination that needs different egress from everything else - a partner reached over
     * mutual tls, or one endpoint that must bypass the proxy. It *replaces* rather than merges,
     * because a dispatcher is one connection policy and half of two is not a policy.
     *
     * Everything sent the same way belongs on `HttpClientOptions.dispatcher` instead, so that a
     * proxy or a CA bundle is stated once rather than at every call site.
     */
    dispatcher: HttpClientDispatcher,
    /**
     * The mime type that the request body should be sent as.
     *
     * Defaults to using the request's Content-Type header if set, falling back to treating the body as JSON otherwise.
     * An xml body is an `XmlString`.
     */
    requestBodyType: RequestBodyType,
    /**
     * Definition on how the response body should look like. Can either be a class that defines the structure of the body,
     * a full body metadata definition, or several shapes the body can be one of.
     *
     * THIS ALSO ACTUALLY VALIDATES THE RESPONSE.
     */
    responseBody: ResponseBody,
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
    IsArray extends boolean = false,
    ResponseBody extends HttpClientResponseBodyInput<T, IsArray> = Newable<T>,
    RequestBodyType extends HttpClientRequestBodyMimeType = HttpClientRequestBodyMimeType
> = Partial<HttpOptions<T, QueryParamsObject, HeaderParamsObject, ResponseHeaderMetaInputObject, IsArray, ResponseBody, RequestBodyType>>;

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
        IsArray extends boolean,
        ResponseBody extends HttpClientResponseBodyInput<T, IsArray> = never,
        RequestBodyType extends HttpClientRequestBodyMimeType = HttpClientRequestBodyMimeType
    >(
        method: HttpMethod,
        url: string,
        requestBody: NoInfer<HttpClientRequestBody<RequestBodyType>>,
        options: HttpOptionsInput<
            T,
            QueryParamsObject,
            HeaderParamsObject,
            ResponseHeaderMetaInputObject,
            IsArray,
            ResponseBody,
            RequestBodyType
        > | undefined
    ) => Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
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
    ) => Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
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
    ) => Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
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
    ) => Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
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
    ) => Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
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
    ) => Promise<
        HttpClientResponseForBody<
            T,
            HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
            ResponseBody,
            IsArray
        >
    >
}