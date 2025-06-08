import { ZibriApplication } from '../application';
import { HttpRequest } from '../http';
import { HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';

export interface ParserInterface {
    parseRequestBody: (req: HttpRequest) => Promise<unknown>,
    parsePathParam: (req: HttpRequest, metadata: PathParamMetadata) => unknown,
    parseQueryParam: (req: HttpRequest, metadata: QueryParamMetadata) => unknown,
    parseHeaderParam: (req: HttpRequest, metadata: HeaderParamMetadata) => unknown,
    attachTo: (app: ZibriApplication) => void
}