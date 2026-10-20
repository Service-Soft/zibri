import { type ApiKeyServiceInterface } from './api-key-service.interface.ts';
import { ApiKey } from './api-key.model.ts';
import { API_KEY_PREFIX } from './api-key.service.ts';
import { ZibriApplication } from '../../../application/application.ts';
import { HttpRequestContext } from '../../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context.ts';
import { Inject } from '../../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { OpenApiSecuritySchemeObject } from '../../../open-api/open-api.model.ts';
import { Ms } from '../../../utilities/ms.ts';
import { IntrospectionResponse } from '../../authorization-server/introspection-response.model.ts';
import { BaseUser } from '../../models/base-user.model.ts';
import { type UserServiceInterface } from '../../user/user-service.interface.ts';
import { CredentialLimits } from '../credential-limits.model.ts';
import { TokenIntrospectingAuthStrategyInterface } from '../token-introspecting-auth-strategy.interface.ts';

/**
 * Api key auth strategy implementation of Zibri.
 *
 * A request sends an api key of a user in the api key header, or as a bearer token, and acts as that
 * user, holding the roles the key may use that the user still has. Keys are created and revoked
 * through `AuthService`.
 */
export class ApiKeyAuthStrategy<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements TokenIntrospectingAuthStrategyInterface<RoleType, UserType> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly name: string = 'api-key';

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly securityScheme: OpenApiSecuritySchemeObject;

    /**
     * The key each request sends, keyed by the request so an entry is gone when the request is.
     */
    private readonly requestKeys: WeakMap<HttpRequestContext | WebsocketRequestContext, Promise<ApiKey | undefined>> = new WeakMap();

    private get apiKeyService(): ApiKeyServiceInterface {
        return inject(ZIBRI_DI_TOKENS.API_KEY_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.API_KEY_HEADER)
        private readonly header: string,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface
    ) {
        this.securityScheme = { type: 'apiKey', in: 'header', name: header, description: 'An api key of a user' };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    init(app: ZibriApplication): void {
        this.apiKeyService.registerReader(app, ApiKeyAuthStrategy.name);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    hasCredential(context: HttpRequestContext | WebsocketRequestContext): boolean {
        // the header being there, not a key that is any good, for the reason the jwt strategy gives
        return context.request.headers?.[this.header] != undefined || this.findBearerKey(context) != undefined;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<UserType | undefined> {
        const apiKey: ApiKey | undefined = await this.findRequestKey(context);
        if (apiKey == undefined) {
            return undefined;
        }
        const user: UserType | undefined = await this.userService.findById<RoleType, UserType, false>(apiKey.userId, { required: false });
        if (user == undefined) {
            return undefined;
        }
        // narrowed on the user itself rather than beside it, so that a handler reading the roles of the
        // current user sees what the key may do too, and not only the route checks. The user's current
        // roles, so that a role taken from the user is taken from their keys
        return { ...user, roles: user.roles.filter(role => apiKey.roles.includes(role)) };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveCredentialLimits(context: HttpRequestContext | WebsocketRequestContext): Promise<CredentialLimits | undefined> {
        const apiKey: ApiKey | undefined = await this.findRequestKey(context);
        return apiKey == undefined ? undefined : { roles: apiKey.roles, tenantId: apiKey.tenantId ?? undefined };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveAuthenticatedAt(): Promise<Date | undefined> {
        // a key is never logged in with, so there is no time to give
        return await Promise.resolve<Date | undefined>(undefined);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveExpiresAt(context: HttpRequestContext | WebsocketRequestContext): Promise<Date | undefined> {
        const apiKey: ApiKey | undefined = await this.findRequestKey(context);
        return apiKey?.expiresAt ?? undefined;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async introspectToken(token: string): Promise<IntrospectionResponse> {
        const apiKey: ApiKey | undefined = token.startsWith(API_KEY_PREFIX) ? await this.apiKeyService.findActiveByKey(token) : undefined;
        const user: UserType | undefined = apiKey == undefined
            ? undefined
            : await this.userService.findById<RoleType, UserType, false>(apiKey.userId, { required: false });
        if (apiKey == undefined || user == undefined || user.deactivatedAt != undefined) {
            return { active: false };
        }
        // a service asking about the key was sent it by its holder
        await this.apiKeyService.recordUse(apiKey);
        return {
            active: true,
            scope: user.roles.filter(role => apiKey.roles.includes(role)).join(' '),
            client_id: apiKey.id,
            username: user.email,
            sub: user.id,
            iat: Math.floor(new Date(apiKey.createdAt).getTime() / Ms.SECOND),
            ...apiKey.expiresAt == undefined ? {} : { exp: Math.floor(new Date(apiKey.expiresAt).getTime() / Ms.SECOND) }
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async revokeToken(token: string): Promise<void> {
        const apiKey: ApiKey | undefined = await this.apiKeyService.findActiveByKey(token);
        if (apiKey != undefined) {
            await this.apiKeyService.revoke(apiKey.userId, apiKey.id, undefined);
        }
    }

    /**
     * Finds the active api key a request sends, once per request.
     * @param context - The context of the request.
     * @returns The key, or undefined when the request sends none that works on its own.
     */
    private async findRequestKey(context: HttpRequestContext | WebsocketRequestContext): Promise<ApiKey | undefined> {
        // kept for the request, so that its user and what it may do are one read of the key
        const pending: Promise<ApiKey | undefined> = this.requestKeys.get(context) ?? this.readRequestKey(context);
        this.requestKeys.set(context, pending);
        return await pending;
    }

    private async readRequestKey(context: HttpRequestContext | WebsocketRequestContext): Promise<ApiKey | undefined> {
        const header: string | string[] | undefined = context.request.headers?.[this.header];
        const key: string | string[] | undefined = header ?? this.findBearerKey(context);
        if (typeof key !== 'string') {
            return undefined;
        }
        const apiKey: ApiKey | undefined = await this.apiKeyService.findActiveByKey(key);
        // a key whose tokens are bound to a DPoP key is only ever exchanged for one: sent itself, it
        // would be the bearer credential the binding is there to avoid
        if (apiKey?.requireDpop !== false) {
            return undefined;
        }
        await this.apiKeyService.recordUse(apiKey);
        return apiKey;
    }

    /**
     * Finds an api key a request sends as a bearer token, for a client that can send no header of
     * its own, such as an identity provider provisioning users.
     * @param context - The context of the request.
     * @returns The key, or undefined when the bearer token is none or not an api key.
     */
    private findBearerKey(context: HttpRequestContext | WebsocketRequestContext): string | undefined {
        const authorization: string | string[] | undefined = context.request.headers?.authorization;
        if (typeof authorization !== 'string') {
            return undefined;
        }
        const [scheme, token] = authorization.split(' ');
        return scheme === 'Bearer' && token?.startsWith(API_KEY_PREFIX) === true ? token : undefined;
    }
}