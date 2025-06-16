import { HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';
import { Newable } from '../types';

export interface ValidationServiceInterface {
    validateRequestBody: (model: unknown, cls: Newable<unknown>) => void,
    validateHeaderParam: (param: unknown, meta: HeaderParamMetadata) => void,
    validatePathParam: (param: unknown, meta: PathParamMetadata) => void,
    validateQueryParam: (param: unknown, meta: QueryParamMetadata) => void
}