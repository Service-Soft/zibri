import { HttpRequest } from '../http/http-request.model.ts';
import { MimeType } from '../http/mime-type.enum.ts';
import { HttpClientResponse } from '../http-client/http-client-response.model.ts';
import { BodyMetadata, BodyMetadataForType } from '../routing/decorators/body-metadata.model.ts';
import { WebsocketRequest } from '../websocket/models/websocket-request.model.ts';

/**
 * The body metadata a parser for the given content type receives.
 */
export type BodyParserMetadata<M extends MimeType> = M extends BodyMetadata['type'] ? BodyMetadataForType<M> : unknown;

/**
 * Interface for a body parser.
 */
export interface BodyParserInterface<M extends MimeType> {
    /**
     * The content type that can be handled by this parser.
     */
    readonly contentType: M,
    /**
     * Parses the body of the http request.
     */
    parseFromHttpRequest: (req: HttpRequest, bodyMetadata: BodyParserMetadata<M>) => unknown | Promise<unknown>,
    /**
     * Parses the body of the websocket request.
     */
    parseFromWebsocketRequest: (req: WebsocketRequest, bodyMetadata: BodyParserMetadata<M>) => unknown | Promise<unknown>,
    /**
     * Parses the body of the http response.
     */
    parseFromHttpClientResponse: (res: HttpClientResponse, bodyMetadata: BodyParserMetadata<M>) => unknown | Promise<unknown>
}

/**
 * A body parser for any one content type.
 */
// distributed on purpose: BodyParserInterface<MimeType> would be one parser that accepts the metadata of every content type
export type AnyBodyParser = { [M in MimeType]: BodyParserInterface<M> }[MimeType];

/**
 * Checks whether or not the given value is a body parser.
 * @param value - The value to check.
 * @returns True if the value has all the keys of BodyParserInterface, false otherwise.
 */
export function isBodyParser(value: unknown): value is AnyBodyParser {
    const keys: (keyof AnyBodyParser)[] = [
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