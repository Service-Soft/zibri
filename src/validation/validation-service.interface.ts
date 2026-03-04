import { BodyMetadata } from '../routing/decorators/body.decorator';
import { HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing/decorators/param.decorator';

/**
 * Interface for a validation service.
 */
export interface ValidationServiceInterface {
    /**
     * Validate a request/response body.
     */
    validateBody: (body: unknown, meta: BodyMetadata) => void,
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
    validateQueryParam: (param: unknown, meta: QueryParamMetadata) => void,
    /**
     * Checks if the given value is a valid websocket request.
     * This does NOT check its content like the body or params, but only the base structure.
     */
    validateWebsocketRequest: (req: unknown) => void
}