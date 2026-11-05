import { HttpRequestContext } from '../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { InternalError } from '../../../error-handling/internal-error.model';

/**
 * What the cookie a login is tied to the browser with is named, followed by the attempt's id.
 */
const BINDING_COOKIE_PREFIX: string = 'zibri-federated-';

/**
 * The cookies that tie a login at a provider to the browser that started it, read and written on
 * the http request being handled.
 */
export abstract class FederatedBindingUtilities {
    /**
     * Gets the name of the cookie a login attempt is tied to the browser with.
     * @param attemptId - The id of the attempt.
     * @returns The name.
     */
    static getCookieName(attemptId: string): string {
        return `${BINDING_COOKIE_PREFIX}${attemptId}`;
    }

    /**
     * Finds a cookie the browser sent with the request being handled.
     * @param name - The name of the cookie.
     * @returns Its value, or undefined when the browser sent none.
     * @throws When no http request is being handled.
     */
    static findCookie(name: string): string | undefined {
        // eslint-disable-next-line typescript/no-unsafe-member-access
        const value: unknown = this.resolveHttpContext().request.cookies?.[name];
        return typeof value === 'string' ? value : undefined;
    }

    /**
     * Sets a cookie binding a login to the browser on the response of the request being handled:
     * http only, secure on https, for the whole site.
     * @param name - The name of the cookie.
     * @param value - Its value.
     * @param maxAgeInMs - How long the browser keeps it.
     * @param sameSite - `lax`, which the browser sends when the provider sends it back with a GET, or
     * `none`, which it also sends when the provider posts a form back, and which is always secure.
     * @throws When no http request is being handled.
     */
    static setCookie(name: string, value: string, maxAgeInMs: number, sameSite: 'lax' | 'none'): void {
        const context: HttpRequestContext = this.resolveHttpContext();
        // a browser refuses SameSite=None on a cookie that is not secure
        context.response.cookie(name, value, {
            httpOnly: true,
            sameSite,
            secure: sameSite === 'none' || context.request.secure,
            maxAge: maxAgeInMs,
            path: '/'
        });
    }

    /**
     * Has the browser forget a cookie, on the response of the request being handled.
     * @param name - The name of the cookie.
     * @throws When no http request is being handled.
     */
    static clearCookie(name: string): void {
        const context: HttpRequestContext = this.resolveHttpContext();
        context.response.clearCookie(name, { httpOnly: true, sameSite: 'lax', secure: context.request.secure, path: '/' });
    }

    private static resolveHttpContext(): HttpRequestContext {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            throw new InternalError('A login at a provider runs inside an http request.');
        }
        return context;
    }
}