import { BodyMetadata, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';

/**
 * Interface for a validation service.
 */
export interface ValidationServiceInterface {
    /**
     * Validate a request body.
     */
    validateRequestBody: (body: unknown, meta: BodyMetadata) => void,
    /**
     * Validate a header param.
     */
    validateHeaderParam: (param: unknown, meta: HeaderParamMetadata) => void,
    /**
     * Validate a path parameter.
     */
    validatePathParam: (param: unknown, meta: PathParamMetadata) => void,
    /**
     * Validate a query parameter.
     */
    validateQueryParam: (param: unknown, meta: QueryParamMetadata) => void
}