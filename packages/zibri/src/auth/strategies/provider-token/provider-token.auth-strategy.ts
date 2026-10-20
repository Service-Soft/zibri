import { HttpRequestContext } from '../../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context.ts';
import { Inject } from '../../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { OpenApiSecuritySchemeObject } from '../../../open-api/open-api.model.ts';
import { isProviderTokenAuthenticator, ProviderTokenAuthenticatorInterface } from '../../authenticators/provider-token-authenticator.interface.ts';
import { ProviderToken } from '../../authenticators/provider-token.model.ts';
import { type DpopServiceInterface } from '../../dpop/dpop-service.interface.ts';
import { BaseUser } from '../../models/base-user.model.ts';
import { type UserServiceInterface } from '../../user/user-service.interface.ts';
import { AuthStrategyInterface } from '../auth-strategy.interface.ts';
import { AuthorizationHeaderUtilities } from '../authorization-header.utilities.ts';
import { AuthorizationToken } from '../authorization-token.model.ts';
import { ClientCertificateUtilities } from '../client-certificate/client-certificate.utilities.ts';

/**
 * Provider token auth strategy implementation of Zibri.
 *
 * Reads the tokens an identity provider issued, such as the access token a mobile app holds from the
 * company's identity provider: a request sends one as a bearer token, and acts as the user the
 * identity it names is linked to. The token is handed to the registered authenticator whose `issuer`
 * it names, which verifies it, so at least one authenticator has to take its provider's tokens.
 */
export class ProviderTokenAuthStrategy<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements AuthStrategyInterface<RoleType, UserType> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly name: string = 'provider-token';

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly securityScheme: OpenApiSecuritySchemeObject = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'An access token or ID token an identity provider issued, in the format `Bearer <token>`'
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.DPOP_SERVICE)
        private readonly dpopService: DpopServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    init(): void {
        const authenticators: ProviderTokenAuthenticatorInterface<string, BaseUser<string>, unknown>[] = this.findAuthenticators();
        if (!authenticators.length) {
            throw new InternalError(
                `${ProviderTokenAuthStrategy.name} reads the tokens of identity providers, and no authenticator of the application takes its provider's tokens: register one that does, such as one extending BaseOidcAuthenticator with bearerTokens.`
            );
        }
        // a token goes to the one authenticator its issuer names, so a second one would never be asked
        for (const authenticator of authenticators) {
            const taking: ProviderTokenAuthenticatorInterface<string, BaseUser<string>, unknown> | undefined = this.findAuthenticator(
                authenticator.issuer
            );
            if (taking != undefined && taking !== authenticator) {
                throw new InternalError(
                    `${ProviderTokenAuthStrategy.name} reads the tokens of ${authenticator.issuer}, which ${taking.constructor.name} and ${authenticator.constructor.name} both take: have one of them take its provider's tokens.`
                );
            }
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    hasCredential(context: HttpRequestContext | WebsocketRequestContext): boolean {
        // a jwt naming the issuer of a provider being there, not a valid one, for the reason the jwt
        // strategy gives. That strategy takes the application's own
        const issuer: string | undefined = AuthorizationHeaderUtilities.findJwtIssuer(context);
        return issuer != undefined && this.findAuthenticator(issuer) != undefined;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<UserType | undefined> {
        const token: ProviderToken | undefined = await this.findRequestToken(context);
        return token == undefined
            ? undefined
            : await this.userService.findById<RoleType, UserType, false>(token.userId, { required: false });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveAuthenticatedAt(context: HttpRequestContext | WebsocketRequestContext): Promise<Date | undefined> {
        return (await this.findRequestToken(context))?.authenticatedAt;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveExpiresAt(context: HttpRequestContext | WebsocketRequestContext): Promise<Date | undefined> {
        return (await this.findRequestToken(context))?.expiresAt;
    }

    /**
     * Reads the provider's token a request sends, when it verifies and the request proves the key or
     * presents the certificate it may be bound to.
     * @param context - The context of the request.
     * @returns What the token says, or undefined.
     */
    private async findRequestToken(context: HttpRequestContext | WebsocketRequestContext): Promise<ProviderToken | undefined> {
        const token: AuthorizationToken | undefined = AuthorizationHeaderUtilities.findToken(context);
        const issuer: string | undefined = AuthorizationHeaderUtilities.findJwtIssuer(context);
        const authenticator: ProviderTokenAuthenticatorInterface<string, BaseUser<string>, unknown> | undefined = issuer == undefined
            ? undefined
            : this.findAuthenticator(issuer);
        const found: ProviderToken | undefined = token == undefined || authenticator == undefined
            ? undefined
            : await authenticator.findProviderToken(token.value);
        // bound to a DPoP key, which the request proves it holds: a token stolen without the key is
        // worth nothing
        if (token == undefined || found == undefined || !await this.dpopService.isSentAsBound(context, token, found.dpopKeyThumbprint)) {
            return undefined;
        }
        return ClientCertificateUtilities.isSentWithBoundCertificate(context, found.certificateThumbprint) ? found : undefined;
    }

    /**
     * Finds the registered authenticator that takes the tokens of the given issuer.
     * @param issuer - The issuer a token names.
     * @returns The authenticator, or undefined when none takes its tokens.
     */
    private findAuthenticator(issuer: string): ProviderTokenAuthenticatorInterface<string, BaseUser<string>, unknown> | undefined {
        // compared as urls, as the issuer of a linked identity is: the issuer an authenticator is
        // configured with may differ from the one its provider publishes by a trailing slash
        const href: string | undefined = URL.canParse(issuer) ? new URL(issuer).href : undefined;
        return href == undefined
            ? undefined
            : this.findAuthenticators().find(authenticator => URL.canParse(authenticator.issuer)
                && new URL(authenticator.issuer).href === href);
    }

    private findAuthenticators(): ProviderTokenAuthenticatorInterface<string, BaseUser<string>, unknown>[] {
        return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).authenticators
            .map(authenticator => inject(authenticator))
            .filter(authenticator => isProviderTokenAuthenticator(authenticator))
            .filter(authenticator => authenticator.acceptsProviderTokens);
    }
}