import { ZibriApplication } from '../application';
import { HttpRequest, MimeType } from '../http';
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
    parse: (req: HttpRequest | WebsocketRequest, bodyMetadata: BodyMetadata) => Promise<unknown>
}