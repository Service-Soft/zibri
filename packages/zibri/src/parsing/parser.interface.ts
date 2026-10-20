import { HttpRequest } from '../http/http-request.model.ts';
import { HttpClientResponse } from '../http-client/http-client-response.model.ts';
import { BodyMetadata } from '../routing/decorators/body-metadata.model.ts';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator.ts';
import { WebsocketRequest } from '../websocket/models/websocket-request.model.ts';

/**
 * Interface for a parser.
 */
export interface ParserInterface {
    /**
     * Parses the body resolved from the given metadata.
     */
    parseBody: (
        req: HttpRequest | WebsocketRequest | HttpClientResponse,
        metadata: BodyMetadata
    ) => unknown | Promise<unknown>,
    /**
     * Parses the path param resolved from the given metadata.
     */
    parsePathParam: (req: HttpRequest | WebsocketRequest, metadata: PathParamMetadata) => unknown,
    /**
     * Parses the query param resolved from the given metadata.
     */
    parseQueryParam: (req: HttpRequest | WebsocketRequest, metadata: QueryParamMetadata) => unknown,
    /**
     * Parses the header param resolved from the given metadata.
     */
    parseHeaderParam: (req: HttpRequest | WebsocketRequest | HttpClientResponse, metadata: HeaderParamMetadata) => unknown
}