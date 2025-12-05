import { ZibriApplication } from '../application';
import { HttpRequest, MimeType } from '../http';
import { HttpClientResponse } from '../http-client';
import { BodyMetadata } from '../routing';
import { WebsocketRequest } from '../websocket';

/**
 * Interface for a body parser.
 */
export interface BodyParserInterface {
    /**
     * The content type that can be handled by this parser.
     */
    readonly contentType: MimeType,
    /**
     * Attaches the body parser to the Zibri application.
     */
    attachTo?: (app: ZibriApplication) => Promise<void> | void,
    /**
     * Parses the body of the http request.
     */
    parseFromHttpRequest: (req: HttpRequest, bodyMetadata: BodyMetadata) => unknown | Promise<unknown>,
    /**
     * Parses the body of the websocket request.
     */
    parseFromWebsocketRequest: (req: WebsocketRequest, bodyMetadata: BodyMetadata) => unknown | Promise<unknown>,
    /**
     * Parses the body of the http response.
     */
    parseFromHttpClientResponse: (res: HttpClientResponse, bodyMetadata: BodyMetadata) => unknown | Promise<unknown>
}