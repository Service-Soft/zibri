
import { BaseContext } from '../base-context.ts';
import { RequestContextToken } from './request-context-token.model.ts';
import { HttpRequest } from '../../http/http-request.model.ts';
import { HttpResponse } from '../../http/http-response.model.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * The context of an incoming http request.
 */
export class HttpRequestContext extends BaseContext<'http-request'> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly type: 'http-request' = 'http-request' as const;

    /**
     * The controller the request was routed to, or undefined while routing has not resolved yet.
     */
    controllerClass: Newable<unknown> | undefined = undefined;

    /**
     * The method on that controller, or undefined while routing has not resolved yet.
     */
    controllerMethod: string | undefined = undefined;

    constructor(
        readonly request: HttpRequest,
        readonly response: HttpResponse
    ) {
        super();
    }

    /**
     * Records the route this request matched.
     *
     * A http request is routed after its context exists - the version that decides which handler
     * runs is itself read off the context - so the matched route cannot be a constructor argument.
     * Everything that reads it does so from a handler, which is downstream of this call.
     * @param controllerClass - The controller that will handle the request.
     * @param controllerMethod - The method on it that will handle the request.
     */
    matchedBy(controllerClass: Newable<unknown>, controllerMethod: string): void {
        this.controllerClass = controllerClass;
        this.controllerMethod = controllerMethod;
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