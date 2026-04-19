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
import { KnownHeader } from '../../http/known-header.enum';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

const allRequestContextTokenKeys: Set<string> = new Set();

/**
 * Defines a request context token for the given key.
 */
export class RequestContextToken<T> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly __brand?: T;

    constructor(
        readonly key: string,
        readonly fn: (ctx: HttpRequestContext | WebsocketRequestContext) => T
    ) {
        if (allRequestContextTokenKeys.has(key)) {
            throw new Error([`A RequestContextToken with the key "${key}" already exists.`].join('\n'));
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
    CORRELATION_ID: new RequestContextToken<string>(
        'correlation_id',
        ctx => {
            const correlationIdHeader: string = inject(ZIBRI_DI_TOKENS.CORRELATION_ID_HEADER);
            return ctx.request.headers[correlationIdHeader as KnownHeader] ?? UUIDUtilities.generate();
        }
    ),
    CURRENT_USER: new RequestContextToken(
        'current_user',
        async ctx => {
            const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
            if (!ctx.controllerClass || !ctx.controllerMethod) {
                return await authService.getCurrentUser(ctx, authService.strategies, false);
            }

            const currentUserMetadata: CurrentUserMetadata | undefined = MetadataUtilities.getRouteCurrentUser(
                ctx.controllerClass,
                ctx.controllerMethod
            );

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

            const isLoggedInMetadata: IsLoggedInMetadata | undefined = await authService.resolveIsLoggedInMetadata(
                ctx.controllerClass,
                ctx.controllerMethod
            );
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
            if (!ctx.controllerClass || !ctx.controllerMethod) {
                return false;
            }

            const user: BaseUser<string> | undefined = await ctx.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_USER);
            if (!user) {
                return false;
            }
            return await twoFactorService.has2fa(user, ctx);
        }
    )
} as const satisfies Record<string, RequestContextToken<unknown>>;