import { BaseContext } from '../base-context';
import { RequestContextToken } from './request-context-token.model';
import { HttpRequest } from '../../http/http-request.model';
import { Newable } from '../../types/newable.type';

/**
 * The context of an incoming http request.
 */
export class HttpRequestContext extends BaseContext<'http-request'> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly type: 'http-request' = 'http-request';

    constructor(
        readonly request: HttpRequest,
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
    get<T>(token: RequestContextToken<T>): T | Promise<T> {
        if (!this.has(token)) {
            this.tokenValues.set(token.key, token.fn(this));
        }
        return this.tokenValues.get(token.key) as T | Promise<T>;
    }
}