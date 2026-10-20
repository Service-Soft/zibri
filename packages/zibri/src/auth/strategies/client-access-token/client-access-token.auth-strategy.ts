import { ZibriApplication } from '../../../application/application.ts';
import { HttpRequestContext } from '../../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { $ts } from '../../../localization/translate.function.ts';
import { OpenApiSecuritySchemeObject } from '../../../open-api/open-api.model.ts';
import { Ms } from '../../../utilities/ms.ts';
import { UUIDUtilities } from '../../../utilities/uuid.utilities.ts';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function.ts';
import { type BaseWebsocketConnection } from '../../../websocket/models/connection/base-websocket-connection.model.ts';
import { type WebsocketServiceInterface } from '../../../websocket/services/websocket-service.interface.ts';
import { IntrospectionResponse } from '../../authorization-server/introspection-response.model.ts';
import { OAuth2ErrorCode } from '../../authorization-server/oauth2-error-code.enum.ts';
import { OAuth2Error } from '../../authorization-server/oauth2.error.ts';
import { type DpopServiceInterface } from '../../dpop/dpop-service.interface.ts';
import { BaseUser } from '../../models/base-user.model.ts';
import { type UserServiceInterface } from '../../user/user-service.interface.ts';
import { type ApiKeyServiceInterface } from '../api-key/api-key-service.interface.ts';
import { ApiKey } from '../api-key/api-key.model.ts';
import { AuthorizationHeaderUtilities } from '../authorization-header.utilities.ts';
import { AuthorizationToken } from '../authorization-token.model.ts';
import { ClientAccessTokenGrant } from '../client-access-token-grant.model.ts';
import { ClientAccessTokenIssuingAuthStrategyInterface } from '../client-access-token-issuing-auth-strategy.interface.ts';
import { ClientCertificateUtilities } from '../client-certificate/client-certificate.utilities.ts';
import { CredentialLimits } from '../credential-limits.model.ts';
import { IssuedClientAccessToken } from '../issued-client-access-token.model.ts';
import { type AccessTokenRevocation } from '../jwt/access-token-revocation.type.ts';
import { isJwtClientAccessTokenPayload, JwtClientAccessTokenPayload } from '../jwt/jwt-client-access-token-payload.model.ts';
import { isJwtConfirmation, JwtConfirmation } from '../jwt/jwt-confirmation.model.ts';
import { JwtRevokedAccessTokenCleanupCronJob } from '../jwt/jwt-revoked-access-token-cleanup.cron-job.ts';
import { JwtRevokedAccessToken, JwtRevokedAccessTokenCreateData } from '../jwt/jwt-revoked-access-token.model.ts';
import { type JwtServiceInterface } from '../jwt/jwt-service.interface.ts';
import { VerifiedJwt } from '../jwt/verified-jwt.model.ts';

/**
 * What a verified access token of a client says.
 */
type ClientAccessToken = {
    /**
     * The verified token.
     */
    verified: VerifiedJwt,
    /**
     * Its payload, read as that of a client's token.
     */
    payload: JwtClientAccessTokenPayload,
    /**
     * The roles the token may use.
     */
    roles: string[]
};

/**
 * Client access token auth strategy implementation of Zibri.
 *
 * Issues the access tokens the authorization server hands to clients, and reads them: a request sends
 * one as a bearer token, and acts as the user of the client's api key, holding the roles the token may
 * use that the user still has. A token bound to a client certificate is taken only beside that
 * certificate. The tokens are signed with the access token key of `ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS`.
 */
export class ClientAccessTokenAuthStrategy<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements ClientAccessTokenIssuingAuthStrategyInterface<RoleType, UserType> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly name: string = 'client-access-token';

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly securityScheme: OpenApiSecuritySchemeObject = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'An access token the authorization server issued to a client, in the format `Bearer <token>`'
    };

    // read when used rather than injected, so that an application without the entities is told to
    // declare them by init, instead of failing on a repository token while this is built
    private get revokedAccessTokenRepository(): Repository<JwtRevokedAccessToken, JwtRevokedAccessTokenCreateData> {
        return inject(repositoryTokenFor(JwtRevokedAccessToken));
    }

    private get apiKeyService(): ApiKeyServiceInterface {
        return inject(ZIBRI_DI_TOKENS.API_KEY_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.JWT_SERVICE)
        private readonly jwtService: JwtServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.DPOP_SERVICE)
        private readonly dpopService: DpopServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION)
        private readonly accessTokenRevocation: AccessTokenRevocation
    ) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    init(app: ZibriApplication): void {
        if (this.accessTokenRevocation === 'onExpiry') {
            return;
        }
        // revoked at once: a token stops working with its api key, and is kept as revoked until it expires
        validateEntitiesRegistered(ClientAccessTokenAuthStrategy.name, app, ApiKey, JwtRevokedAccessToken);
        if (!app.options.cronJobs.includes(JwtRevokedAccessTokenCleanupCronJob)) {
            app.options.cronJobs.push(JwtRevokedAccessTokenCleanupCronJob);
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    hasCredential(context: HttpRequestContext | WebsocketRequestContext): boolean {
        // a bearer token shaped like a client's being there, not a valid one, for the reason the jwt
        // strategy gives. That strategy takes every other jwt
        return AuthorizationHeaderUtilities.findJwtKind(context, this.jwtService.issuer) === 'client';
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<UserType | undefined> {
        const token: ClientAccessToken | undefined = await this.findRequestToken(context);
        if (token == undefined) {
            return undefined;
        }
        const [user, live] = await Promise.all([
            this.userService.findById<RoleType, UserType, false>(token.payload.sub, { required: false }),
            this.isLive(token.payload)
        ]);
        if (user == undefined || !live) {
            return undefined;
        }
        // narrowed on the user itself rather than beside it, as an api key's roles are, so that a
        // handler reading the current user sees what the token may do too. The user's current roles,
        // so that a role taken from the user is taken from the tokens
        return { ...user, roles: user.roles.filter(role => token.roles.includes(role)) };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveClaimedUser(context: HttpRequestContext | WebsocketRequestContext): Promise<BaseUser<RoleType> | undefined> {
        const token: ClientAccessToken | undefined = await this.findRequestToken(context);
        return token == undefined
            ? undefined
            : { id: token.payload.sub, email: token.payload.email, roles: token.roles.filter(role => this.isRole<RoleType>(role)) };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveCredentialLimits(context: HttpRequestContext | WebsocketRequestContext): Promise<CredentialLimits | undefined> {
        // read off the token rather than the key, so that what the token may do is what it was issued
        // with, whether or not the key is read again
        const token: ClientAccessToken | undefined = await this.findRequestToken(context);
        return token == undefined ? undefined : { roles: token.roles, tenantId: token.payload.tenant_id };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveAuthenticatedAt(): Promise<Date | undefined> {
        // a client is never logged in with, so there is no time to give
        return await Promise.resolve<Date | undefined>(undefined);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveExpiresAt(context: HttpRequestContext | WebsocketRequestContext): Promise<Date | undefined> {
        const token: ClientAccessToken | undefined = await this.findRequestToken(context);
        return token == undefined ? undefined : new Date(token.verified.expiresAt * Ms.SECOND);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async issueClientAccessToken(user: BaseUser<string>, grant: ClientAccessTokenGrant): Promise<IssuedClientAccessToken> {
        const confirmation: JwtConfirmation = {
            ...grant.certificateThumbprint == undefined ? {} : { 'x5t#S256': grant.certificateThumbprint },
            ...grant.dpopKeyThumbprint == undefined ? {} : { jkt: grant.dpopKeyThumbprint }
        };
        const payload: JwtClientAccessTokenPayload = {
            sub: user.id,
            email: user.email,
            scope: grant.roles.join(' '),
            client_id: grant.clientId,
            jti: UUIDUtilities.generate(),
            ...grant.tenantId == undefined ? {} : { tenant_id: grant.tenantId },
            ...isJwtConfirmation(confirmation) ? { cnf: confirmation } : {}
        };
        const value: string = await this.jwtService.signAccessToken(payload, grant.audience);
        return { value, expiresInMs: this.jwtService.accessTokenExpiresInMs };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async introspectToken(token: string): Promise<IntrospectionResponse> {
        // whoever the token is for: a service asking about it is not the application
        const found: ClientAccessToken | undefined = await this.findClientAccessToken(token, undefined);
        if (found == undefined) {
            return { active: false };
        }
        const [user, live] = await Promise.all([
            this.userService.findById<RoleType, UserType, false>(found.payload.sub, { required: false }),
            this.isLive(found.payload)
        ]);
        if (user == undefined || user.deactivatedAt != undefined || !live) {
            return { active: false };
        }
        return {
            active: true,
            // what a request with the token holds now: the user's roles, narrowed to the client's
            scope: user.roles.filter(role => found.roles.includes(role)).join(' '),
            username: user.email,
            token_type: found.payload.cnf?.jkt == undefined ? 'Bearer' : 'DPoP',
            exp: found.verified.expiresAt,
            iat: found.verified.issuedAt,
            sub: user.id,
            aud: found.verified.audience,
            iss: this.jwtService.issuer,
            client_id: found.payload.client_id,
            jti: found.payload.jti,
            ...found.payload.cnf == undefined ? {} : { cnf: found.payload.cnf }
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async revokeToken(token: string): Promise<void> {
        const found: ClientAccessToken | undefined = await this.findClientAccessToken(token, undefined);
        if (found == undefined) {
            return;
        }
        if (this.accessTokenRevocation === 'onExpiry') {
            throw new OAuth2Error(
                OAuth2ErrorCode.UNSUPPORTED_TOKEN_TYPE,
                $ts`Access tokens work until they expire, so they cannot be revoked.`
            );
        }
        if (await this.revokedAccessTokenRepository.findOne({ where: { tokenId: found.payload.jti }, required: false }) != undefined) {
            return;
        }
        await this.revokedAccessTokenRepository.create({
            tokenId: found.payload.jti,
            expirationDate: new Date(found.verified.expiresAt * Ms.SECOND)
        });
        // a socket that connected with the token is closed, the way a request with it is now refused
        await inject<WebsocketServiceInterface<BaseWebsocketConnection>>(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE)
            .disconnectEndedLogins([found.payload.sub], undefined);
    }

    /**
     * Whether the client a token was issued to and the token itself have not ended: its api key still
     * exists and has not expired, and the token was not revoked. Writes down the use of the key when
     * they have not. Always true while access tokens are revoked on expiry.
     * @param payload - What the token says.
     * @returns True while the token may still be used.
     */
    private async isLive(payload: JwtClientAccessTokenPayload): Promise<boolean> {
        // a token that is not checked against its key is no use of the key either: exchanging the key
        // for it was, and that happens at least once a token's lifetime while the client works
        if (this.accessTokenRevocation === 'onExpiry') {
            return true;
        }
        const [apiKey, revoked] = await Promise.all([
            this.apiKeyService.findActiveById(payload.client_id),
            this.revokedAccessTokenRepository.findOne({ where: { tokenId: payload.jti }, required: false })
        ]);
        if (apiKey == undefined || revoked != undefined) {
            return false;
        }
        // a token in use is its key in use, since revoking the key would stop the token
        await this.apiKeyService.recordUse(apiKey);
        return true;
    }

    /**
     * Finds what an access token of a client says.
     * @param token - The token.
     * @param audience - Who the token must be for, or undefined for anyone.
     * @returns What it says, or undefined when it does not verify or is no client's.
     */
    private async findClientAccessToken(token: string, audience: string | undefined): Promise<ClientAccessToken | undefined> {
        const verified: VerifiedJwt | undefined = await this.jwtService.findAccessToken(token, audience);
        if (verified == undefined || !isJwtClientAccessTokenPayload(verified.payload)) {
            return undefined;
        }
        return { verified, payload: verified.payload, roles: verified.payload.scope.split(' ').filter(role => role !== '') };
    }

    /**
     * Reads the client's access token a request sends, when it is one for this application and the
     * request presents the client certificate it may be bound to.
     * @param context - The context of the request.
     * @returns What the token says, or undefined.
     */
    private async findRequestToken(context: HttpRequestContext | WebsocketRequestContext): Promise<ClientAccessToken | undefined> {
        const token: AuthorizationToken | undefined = AuthorizationHeaderUtilities.findToken(context);
        // only a token for this application, so a token issued for another service is refused here
        const found: ClientAccessToken | undefined = token == undefined
            ? undefined
            : await this.findClientAccessToken(token.value, this.jwtService.issuer);
        // bound to a DPoP key, which the request proves it holds: a token stolen without the key is
        // worth nothing
        if (token == undefined || found == undefined || !await this.dpopService.isSentAsBound(context, token, found.payload.cnf?.jkt)) {
            return undefined;
        }
        // bound to a certificate, which the request has to present
        return ClientCertificateUtilities.isSentWithBoundCertificate(context, found.payload.cnf?.['x5t#S256']) ? found : undefined;
    }

    /**
     * Whether a role a token names is a role of the application.
     *
     * Its value is not checked, as with a login's token: nothing here knows which roles the application
     * defines, and a role that is not one of them satisfies no check anyway.
     * @param role - The role the token names.
     * @returns True.
     */
    private isRole<Role extends string>(role: string): role is Role {
        return typeof role === 'string';
    }
}