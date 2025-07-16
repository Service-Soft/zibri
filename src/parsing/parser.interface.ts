import { ZibriApplication } from '../application';
import { HttpRequest } from '../http';
import { BodyMetadata, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing';

/**
 * Interface for a parser.
 */
export interface ParserInterface {
    /**
     * Parses the request body resolved from the given metadata.
     */
    parseRequestBody: (req: HttpRequest, metadata: BodyMetadata) => Promise<unknown>,
    /**
     * Parses the path param resolved from the given metadata.
     */
    parsePathParam: (req: HttpRequest, metadata: PathParamMetadata) => unknown,
    /**
     * Parses the query param resolved from the given metadata.
     */
    parseQueryParam: (req: HttpRequest, metadata: QueryParamMetadata) => unknown,
    /**
     * Parses the header param resolved from the given metadata.
     */
    parseHeaderParam: (req: HttpRequest, metadata: HeaderParamMetadata) => unknown,
    /**
     * Attaches the parser to the Zibri application.
     */
    attachTo: (app: ZibriApplication) => Promise<void> | void
}