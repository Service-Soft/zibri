import { BodyMetadata, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';

export interface ValidationServiceInterface {
    validateRequestBody: (model: unknown, meta: BodyMetadata) => void,
    validateHeaderParam: (param: unknown, meta: HeaderParamMetadata) => void,
    validatePathParam: (param: unknown, meta: PathParamMetadata) => void,
    validateQueryParam: (param: unknown, meta: QueryParamMetadata) => void
}