import { Request } from 'express';

import { Header } from './header.type';
import { HttpMethod } from './http-method.enum';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * Http request. Based on Request from express.
 */
export type HttpRequest<
    T = unknown,
    PathParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
    QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
    HeaderParamsObject extends Record<string, unknown> = Partial<Record<Header, string | undefined>>
// eslint-disable-next-line typescript/no-explicit-any
> = OmitStrict<Request<Record<string, string>, any, T>, 'query' | 'headers' | 'params' | 'method'> & {
    /**
     * The path parameters of the request, as an object.
     */
    params: PathParamsObject,
    /**
     * The query parameters of the request, as an object.
     */
    query: QueryParamsObject,
    /**
     * The header parameters of the request, as an object.
     */
    headers: HeaderParamsObject,
    /**
     * The http method of the request.
     */
    method: HttpMethod
};

/**
 * Check whether or not the given value is a http request.
 * @param value - The value to check.
 * @returns True when value is an instance of HttpError, false otherwise.
 */
export function isHttpRequest(value: unknown): value is HttpRequest {
    return typeof value === 'object'
        && value != undefined
        && 'params' in value
        && 'query' in value
        && 'headers' in value
        && 'httpVersion' in value;
}