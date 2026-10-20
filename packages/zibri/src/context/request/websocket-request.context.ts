import { RequestContextToken } from './request-context-token.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { BaseWebsocketConnection } from '../../websocket/models/connection/base-websocket-connection.model.ts';
import { WebsocketRequest } from '../../websocket/models/websocket-request.model.ts';
import { BaseContext } from '../base-context.ts';

/**
 * The context of an incoming websocket request.
 */
export class WebsocketRequestContext extends BaseContext<'websocket-request'> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly type: 'websocket-request' = 'websocket-request' as const;

    /**
     * Whether the client this message came from has gone.
     *
     * Read where a response would otherwise be written: a message whose socket has closed has
     * nowhere to be answered, which a failed http request always does.
     */
    clientGone: boolean = false;

    constructor(
        readonly request: WebsocketRequest,
        readonly connection: BaseWebsocketConnection | undefined,
        readonly controllerClass: Newable<unknown> | undefined,
        readonly controllerMethod: string | undefined
    ) {
        super();
    }

    /**
     * Whether or not a value for the given token has been cached.
     * @param token - The token to check.
     * @returns True if a value has been cached, false otherwise.
     */
    has<T>(token: RequestContextToken<T>): boolean {
        return this.tokenValues.has(token.key);
    }

    /**
     * Either returns the cached value for the given token or initializes and caches a new value.
     * @param token - The token to get the value of.
     * @returns Either the cached or a new value.
     */
    get<T>(token: RequestContextToken<T>): T {
        if (!this.has(token)) {
            this.tokenValues.set(token.key, token.fn(this));
        }
        return this.tokenValues.get(token.key) as T;
    }
}