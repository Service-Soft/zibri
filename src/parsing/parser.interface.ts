import { Request } from 'express';

import { ZibriApplication } from '../application';
import { HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';

export interface ParserInterface {
    parseRequestBody: (req: Request) => Promise<unknown>,
    parsePathParam: (req: Request, metadata: PathParamMetadata) => unknown,
    parseQueryParam: (req: Request, metadata: QueryParamMetadata) => unknown,
    parseHeaderParam: (req: Request, metadata: HeaderParamMetadata) => unknown,
    attachTo: (app: ZibriApplication) => void
}