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

/**
 * Checks whether or not the given value is a body parser.
 * @param value - The value to check.
 * @returns True if the value has all the keys of BodyParserInterface, false otherwise.
 */
export function isBodyParser(value: unknown): value is BodyParserInterface {
    const keys: (keyof BodyParserInterface)[] = [
        'contentType',
        'parseFromHttpClientResponse',
        'parseFromHttpRequest',
        'parseFromWebsocketRequest'
    ];

    if (value == undefined || typeof value !== 'object') {
        return false;
    }

    for (const key of keys) {
        if (!(key in value)) {
            return false;
        }
    }

    return true;
}