import { HttpRequest } from '../http/http-request.model';
import { MimeType } from '../http/mime-type.enum';
import { HttpClientResponse } from '../http-client/http-client-response.model';
import { BodyMetadata } from '../routing/decorators/body.decorator';
import { WebsocketRequest } from '../websocket/models/websocket-request.model';

/**
 * Interface for a body parser.
 */
export interface BodyParserInterface {
    /**
     * The content type that can be handled by this parser.
     */
    readonly contentType: MimeType,
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