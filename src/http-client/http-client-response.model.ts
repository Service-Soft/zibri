import { AxiosResponse } from 'axios';

import { MimeType, KnownHeader } from '../http';
import { FormData } from '../parsing';
import { BodyMetadata } from '../routing';
import { OmitStrict } from '../types';

/**
 * Definition for a response from using the http client.
 */
export type HttpClientResponse<
    T = undefined,
    HeaderParamsObject extends Record<string, unknown> = Partial<Record<KnownHeader, string | undefined>>
> = OmitStrict<AxiosResponse, 'request' | 'config' | 'headers' | 'data'> & {
    /**
     * The headers of the response.
     */
    headers: HeaderParamsObject,
    /**
     * The raw body of the response as returned by. No parsing or validation has happened here.
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
    BodyType extends BodyMetadata['type']
> = BodyType extends MimeType.FORM_DATA
    ? HttpClientResponse<FormData<T>, HeaderParamsObject>
    : HttpClientResponse<T, HeaderParamsObject>;

/**
 * Checks if the given value is a HttpClientResponse.
 * @param value - The value to check.
 * @returns True when the value is an object with a key "rawBody", false otherwise.
 */
export function isHttpClientResponse(value: unknown): value is HttpClientResponse {
    return typeof value === 'object' && value != undefined && 'rawBody' in value;
}