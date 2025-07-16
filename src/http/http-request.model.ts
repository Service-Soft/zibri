import { Request } from 'express';

import { OmitStrict } from '../types';
import { KnownHeader } from './known-header.enum';

/**
 * Http request. Based on Request from express.
 */
export type HttpRequest<
    T = unknown,
    PathParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
    QueryParamsObject extends Record<string, unknown> = Record<string, string | undefined>,
    HeaderParamsObject extends Record<string, unknown> = Partial<Record<KnownHeader, string | undefined>>
// eslint-disable-next-line typescript/no-explicit-any
> = OmitStrict<Request<Record<string, string>, any, T>, 'query' | 'headers' | 'params'> & {
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
    headers: HeaderParamsObject
};