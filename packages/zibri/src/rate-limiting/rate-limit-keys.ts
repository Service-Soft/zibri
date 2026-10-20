import { type AuthServiceInterface } from '../auth/auth-service.interface.ts';
import { BaseUser } from '../auth/models/base-user.model.ts';
import { HttpRequestContext } from '../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../context/request/websocket-request.context.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';

const GLOBAL_KEY: string = 'global';

/**
 * Ways to say what a rate limit counts per.
 *
 * Counting everything against one bucket is right for a shared resource - an outgoing mail server
 * has a capacity of its own - and wrong for anything a caller can trigger, where it means one
 * attacker exhausts the limit for every user at once. These read the current request rather than the
 * arguments, because who is calling is rarely one of them.
 */
export abstract class RateLimitKeys {
    /**
     * Counts every call against one bucket, whoever makes it.
     *
     * For a limit that belongs to the resource rather than to the caller: a mail server that accepts
     * so many messages an hour whoever asked for them. Worth saying out loud, because a shared
     * bucket is also what lets one caller spend everybody else's capacity.
     *
     * Also where the per caller keys land when there is no request to read a caller from, which is
     * the honest answer: work that nobody triggered cannot be counted against anybody.
     */
    static readonly GLOBAL: string = GLOBAL_KEY;

    /**
     * Counts per caller: the client address over http, the connection over a websocket. The default
     * when a limited method names no key.
     *
     * What unauthenticated routes want - a login, a password reset - where there is no account to
     * count against yet.
     *
     * Over http this is only ever as good as the address: an application behind a proxy has to set
     * `security.trustProxy`, or every request appears to come from that proxy and shares one bucket.
     * A websocket is counted per connection rather than per address, because that is what a
     * websocket caller *is* - and reconnecting to escape a limit costs a handshake every time.
     * @returns The key.
     */
    static perConnection(): string {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            return context?.connection ? `connection:${context.connection.id}` : GLOBAL_KEY;
        }
        return context.request.ip ?? GLOBAL_KEY;
    }

    /**
     * Counts per logged in user, falling back to {@link RateLimitKeys.perConnection} for callers
     * that are not logged in.
     *
     * The fallback is the point: without it every anonymous caller shares one key, so a route that
     * can be reached without logging in would have no per caller limit exactly where it needs one.
     * @returns The key.
     */
    static async perUser(): Promise<string> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!context) {
            return GLOBAL_KEY;
        }
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const user: BaseUser<string> | undefined = await authService.getCurrentUser(context, authService.strategies, false);
        return user ? `user:${user.id}` : RateLimitKeys.perConnection();
    }
}