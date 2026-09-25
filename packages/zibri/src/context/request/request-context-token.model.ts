import { randomBytes } from 'node:crypto';

import { HttpRequestContext } from './http-request.context';
import { WebsocketRequestContext } from './websocket-request.context';
import { TwoFactorServiceInterface } from '../../auth/2fa/two-factor-service.interface';
import { AuthServiceInterface } from '../../auth/auth-service.interface';
import { CurrentUserMetadata } from '../../auth/decorators/current-user.decorator';
import { BaseUser } from '../../auth/models/base-user.model';
import { IsLoggedInMetadata } from '../../auth/models/is-logged-in-metadata.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { RouteRegistry } from '../../global/route-registry/route.registry';
import { TraceContextUtilities } from '../../tracing/trace-context.utilities';
import { TraceSpanContext } from '../../tracing/trace-span-context.model';

const allRequestContextTokenKeys: Set<string> = new Set();

/**
 * Defines a request context token for the given key.
 */
export class RequestContextToken<T> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly __brand!: T;

    constructor(
        readonly key: string,
        readonly fn: (ctx: HttpRequestContext | WebsocketRequestContext) => T
    ) {
        if (allRequestContextTokenKeys.has(key)) {
            throw new InternalError(`A RequestContextToken with the key "${key}" already exists.`);
        }
        allRequestContextTokenKeys.add(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    toString(): string {
        return this.key;
    }
}

/**
 * Tokens for the current request.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_REQUEST_CONTEXT_TOKENS = {
    NONCE: new RequestContextToken(
        'nonce',
        () => randomBytes(16).toString('base64')
    ),
    /**
     * The trace this request belongs to.
     *
     * Read off the headers, where the trace context middleware wrote the resolved context - so a
     * trace this application started reads the same as one it was handed. A websocket request has
     * none: the trace it belongs to is established around the handler rather than carried per
     * message, and `TracingUtilities.getCurrentTraceContext()` is what reads it there.
     */
    TRACE_CONTEXT: new RequestContextToken<TraceSpanContext | undefined>(
        'trace_context',
        ctx => TraceContextUtilities.findSpanContext(ctx.request.headers ?? {})
    ),
    CURRENT_USER: new RequestContextToken(
        'current_user',
        async ctx => {
            const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
            if (!ctx.controllerClass || !ctx.controllerMethod) {
                return await authService.getCurrentUser(ctx, authService.strategies, false);
            }

            const currentUserMetadata: CurrentUserMetadata | undefined = RouteRegistry.get(
                ctx.controllerClass,
                ctx.controllerMethod
            ).params.currentUser;

            return await authService.getCurrentUser(
                ctx,
                currentUserMetadata?.allowedStrategies ?? authService.strategies,
                currentUserMetadata?.required ?? false
            );
        }
    ),
    IS_LOGGED_IN: new RequestContextToken(
        'is_logged_in',
        async ctx => {
            const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
            if (!ctx.controllerClass || !ctx.controllerMethod) {
                return await authService.isLoggedIn(ctx, authService.strategies);
            }

            const isLoggedInMetadata: IsLoggedInMetadata | undefined = RouteRegistry.get(
                ctx.controllerClass,
                ctx.controllerMethod
            ).auth.metadata.isLoggedIn;
            return await authService.isLoggedIn(
                ctx,
                isLoggedInMetadata?.allowedStrategies ?? authService.strategies
            );
        }
    ),
    HAS_2FA: new RequestContextToken(
        'has_2fa',
        async (ctx): Promise<boolean> => {
            const twoFactorService: TwoFactorServiceInterface = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
            // no route is consulted, unlike the two tokens above: whether a second factor was
            // presented is a fact about the request and the user, and a route that accepts only
            // some of the methods states so with `@Auth.require2fa`, which checks them itself.
            const user: BaseUser<string> | undefined = await ctx.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_USER);
            if (!user) {
                return false;
            }
            return await twoFactorService.has2fa(user, ctx);
        }
    ),
    CURRENT_VERSION: new RequestContextToken(
        'current_version',
        async ctx => await inject(ZIBRI_DI_TOKENS.VERSIONING_SERVICE).resolveVersion(ctx)
    ),
    CURRENT_LOCALE: new RequestContextToken(
        'current_locale',
        ctx => inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(ctx)
    )
} as const satisfies Record<string, RequestContextToken<unknown>>;