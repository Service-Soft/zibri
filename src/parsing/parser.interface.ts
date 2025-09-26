import { ZibriApplication } from '../application';
import { HttpRequest } from '../http';
import { BodyMetadata, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';
import { WebsocketRequest } from '../websocket';

/**
 * Interface for a parser.
 */
export interface ParserInterface {
    /**
     * Parses the request body resolved from the given metadata.
     */
    parseRequestBody: (req: HttpRequest | WebsocketRequest, metadata: BodyMetadata) => unknown | Promise<unknown>,
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
    parseHeaderParam: (req: HttpRequest | WebsocketRequest, metadata: HeaderParamMetadata) => unknown,
    /**
     * Attaches the parser to the Zibri application.
     */
    attachTo: (app: ZibriApplication) => Promise<void> | void
}