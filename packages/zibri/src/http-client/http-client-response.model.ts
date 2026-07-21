import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { FormData } from '../parsing/form-data/form-data.model';
import { BodyMetadata } from '../routing/decorators/body.decorator';

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
 * The response for the given response body type.
 */
export type HttpClientResponseForBodyType<
    T extends object,
    HeaderParamsObject extends Record<string, unknown>,
    BodyType extends BodyMetadata['type'],
    IsArray extends boolean
> = BodyType extends MimeType.FORM_DATA
    ? HttpClientResponse<FormData<T>, HeaderParamsObject>
    : HttpClientResponse<IsArray extends true ? T[] : T, HeaderParamsObject>;

/**
 * Checks if the given value is a HttpClientResponse.
 * @param value - The value to check.
 * @returns True when the value is an object with a key "rawBody", false otherwise.
 */
export function isHttpClientResponse(value: unknown): value is HttpClientResponse {
    return typeof value === 'object' && value != undefined && 'rawBody' in value;
}