import { Readable } from 'node:stream';

import { ShapeType } from '../entity/models/shape-type.model';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { FormData } from '../parsing/form-data/form-data.model';
import { FormDataBodyMetadataInput, FormDataBodyShapeMetadataInput, FormUrlEncodedBodyMetadataInput, JsonBodyMetadataInput, JsonBodyShapeMetadataInput, StreamBodyMetadataInput, XmlBodyMetadataInput } from '../routing/decorators/body-metadata.model';
import { Newable } from '../types/newable.type';
import { OmitStrict } from '../types/omit-strict.type';

// eslint-disable-next-line jsdoc/require-jsdoc
type JsonResponseBodyInput<
    T extends object,
    IsArray extends boolean
> = OmitStrict<JsonBodyMetadataInput, 'type' | 'isArray'> & {
    /**
     * The type of the response.
     */
    type: MimeType.JSON,
    /**
     * The class that defines the structure of the body.
     */
    modelClass: Newable<T>,
    /**
     * Whether or not the response is an array.
     */
    isArray?: IsArray
} | OmitStrict<JsonBodyMetadataInput, 'type' | 'isArray' | 'allowAdditionalProperties'> & {
    /**
     * The type of the response.
     */
    type?: MimeType.JSON,
    /**
     * The shapes the body can be. It becomes the first, in this order, that it fits.
     */
    shapes: JsonBodyShapeMetadataInput[]
};

// eslint-disable-next-line jsdoc/require-jsdoc
type XmlResponseBodyInput<
    T extends object,
    IsArray extends boolean
> = OmitStrict<XmlBodyMetadataInput, 'type' | 'isArray'> & {
    /**
     * The type of the response.
     */
    type: MimeType.XML,
    /**
     * The class that defines the structure of the body.
     */
    modelClass: Newable<T>,
    /**
     * Whether or not the response is an array.
     */
    isArray?: IsArray
} | OmitStrict<XmlBodyMetadataInput, 'type' | 'isArray' | 'allowAdditionalProperties'> & {
    /**
     * The type of the response.
     */
    type: MimeType.XML,
    /**
     * The shapes the body can be. It becomes the first, in this order, that it fits.
     */
    shapes: JsonBodyShapeMetadataInput[]
};

// eslint-disable-next-line jsdoc/require-jsdoc
type FormDataResponseBodyInput<T extends object> = OmitStrict<FormDataBodyMetadataInput, 'type'> & {
    /**
     * The type of the response.
     */
    type: MimeType.FORM_DATA,
    /**
     * The class that defines the structure of the body.
     */
    modelClass: Newable<T>
} | OmitStrict<FormDataBodyMetadataInput, 'type' | 'allowAdditionalProperties'> & {
    /**
     * The type of the response.
     */
    type: MimeType.FORM_DATA,
    /**
     * The shapes the body can be. It becomes the first, in this order, that it fits.
     */
    shapes: JsonBodyShapeMetadataInput[]
};

// eslint-disable-next-line jsdoc/require-jsdoc
type FormUrlEncodedResponseBodyInput<T extends object> = OmitStrict<FormUrlEncodedBodyMetadataInput, 'type'> & {
    /**
     * The type of the response.
     */
    type: MimeType.FORM_URL_ENCODED,
    /**
     * The class that defines the structure of the body.
     */
    modelClass: Newable<T>
} | OmitStrict<FormUrlEncodedBodyMetadataInput, 'type' | 'allowAdditionalProperties'> & {
    /**
     * The type of the response.
     */
    type: MimeType.FORM_URL_ENCODED,
    /**
     * The shapes the body can be. It becomes the first, in this order, that it fits.
     */
    shapes: FormDataBodyShapeMetadataInput[]
};

// eslint-disable-next-line jsdoc/require-jsdoc
type StreamResponseBodyInput = StreamBodyMetadataInput & Pick<StreamBodyMetadataInput, 'type'>;

// the types whose body is a model or several shapes, and is read the same way either way
// eslint-disable-next-line jsdoc/require-jsdoc
type StructuredMimeType = MimeType.JSON | MimeType.XML;

// eslint-disable-next-line jsdoc/require-jsdoc
export type HttpClientResponseBodyInput<T extends object, IsArray extends boolean> = Newable<T>
    | JsonResponseBodyInput<T, IsArray>
    | XmlResponseBodyInput<T, IsArray>
    | FormDataResponseBodyInput<T>
    | FormUrlEncodedResponseBodyInput<T>
    | StreamResponseBodyInput;

/**
 * Definition for a response from using the http client.
 */
export type HttpClientResponse<
    T = undefined,
    HeaderParamsObject extends Record<string, unknown> = Partial<Record<KnownHeader, string | undefined>>
> = {
    /**
     * The http status of the response.
     */
    status: HttpStatus,
    /**
     * The http status text of the response.
     */
    statusText: string,
    /**
     * The headers of the response.
     */
    headers: HeaderParamsObject,
    /**
     * The raw body of the response. No parsing or validation has happened here.
     */
    rawBody: unknown,
    /**
     * The parsed and validated response body.
     *
     * When no responseBody definition has been provided by the request than this is undefined.
     */
    body: T
};

/**
 * The response for the given response body definition.
 */
export type HttpClientResponseForBody<
    T extends object,
    HeaderParamsObject extends Record<string, unknown>,
    ResponseBody extends HttpClientResponseBodyInput<T, IsArray>,
    IsArray extends boolean
// no responseBody given: checked non-distributively, because a distributive conditional over never is never
> = [ResponseBody] extends [never]
    ? HttpClientResponse<undefined, HeaderParamsObject>
    // eslint-disable-next-line jsdoc/require-jsdoc
    : ResponseBody extends { type: MimeType.OCTET_STREAM }
        ? HttpClientResponse<Readable, HeaderParamsObject>
        // eslint-disable-next-line jsdoc/require-jsdoc
        : ResponseBody extends { type: MimeType.FORM_DATA, modelClass: Newable<infer Model extends object> }
            ? HttpClientResponse<FormData<Model>, HeaderParamsObject>
            // eslint-disable-next-line jsdoc/require-jsdoc
            : ResponseBody extends { type: MimeType.FORM_DATA, shapes: infer Shapes extends JsonBodyShapeMetadataInput[] }
                ? HttpClientResponse<FormData<Extract<ShapeType<Shapes[number]>, object>>, HeaderParamsObject>
                // eslint-disable-next-line jsdoc/require-jsdoc
                : ResponseBody extends { type: MimeType.FORM_URL_ENCODED, modelClass: Newable<infer Model> }
                    ? HttpClientResponse<Model, HeaderParamsObject>
                    // eslint-disable-next-line jsdoc/require-jsdoc
                    : ResponseBody extends { type: MimeType.FORM_URL_ENCODED, shapes: infer Shapes extends JsonBodyShapeMetadataInput[] }
                        ? HttpClientResponse<ShapeType<Shapes[number]>, HeaderParamsObject>
                        // eslint-disable-next-line jsdoc/require-jsdoc
                        : ResponseBody extends { type?: StructuredMimeType, modelClass: Newable<infer Model> }
                            ? HttpClientResponse<IsArray extends true ? Model[] : Model, HeaderParamsObject>
                            // eslint-disable-next-line jsdoc/require-jsdoc
                            : ResponseBody extends { type?: StructuredMimeType, shapes: infer Shapes extends JsonBodyShapeMetadataInput[] }
                                ? HttpClientResponse<ShapeType<Shapes[number]>, HeaderParamsObject>
                                : ResponseBody extends Newable<infer Model>
                                    ? HttpClientResponse<Model, HeaderParamsObject>
                                    : never;

/**
 * Checks if the given value is a HttpClientResponse.
 * @param value - The value to check.
 * @returns True when the value is an object with a key "rawBody", false otherwise.
 */
export function isHttpClientResponse(value: unknown): value is HttpClientResponse {
    return typeof value === 'object' && value != undefined && 'rawBody' in value;
}