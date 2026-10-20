import type { JWTPayload } from 'jose';
import type { ClientAuth, Configuration, DiscoveryRequestOptions, IDToken, ServerMetadata, TokenEndpointResponse, TokenEndpointResponseHelpers } from 'openid-client';

import { OidcBearerTokens } from './oidc-bearer-tokens.model.ts';
import { ZibriApplication } from '../../../application/application.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { type HttpClientInterface } from '../../../http-client/http-client.interface.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { Ms } from '../../../utilities/ms.ts';
import { BaseUser } from '../../models/base-user.model.ts';
import { EncodedJwt } from '../../strategies/jwt/encoded-jwt-access-token.model.ts';
import { isJwtConfirmation, JwtConfirmation } from '../../strategies/jwt/jwt-confirmation.model.ts';
import { JwtRemoteKeySet } from '../../strategies/jwt/jwt-remote-key-set.type.ts';
import { JwtUtilities } from '../../strategies/jwt/jwt.utilities.ts';
import { FederatedCredentials } from '../federated/federated-credentials.model.ts';
import { FederatedIdentity } from '../federated/federated-identity.model.ts';
import { FederatedProfile } from '../federated/federated-profile.model.ts';
import { FederatedSignInFailure } from '../federated/federated-sign-in-failure.enum.ts';
import { FederatedSignInError } from '../federated/federated-sign-in.error.ts';
import { BaseOAuthAuthenticator } from '../oauth/base-oauth.authenticator.ts';
import { OAuthCodeExchange } from '../oauth/oauth-code-exchange.model.ts';
import { OAuthOfflineAccess } from '../oauth/oauth-offline-access.model.ts';
import { OAuthProviderSignIn } from '../oauth/oauth-provider-sign-in.model.ts';
import { OpenIdClient } from '../oauth/open-id-client.type.ts';
import { ProviderTokenAuthenticatorInterface } from '../provider-token-authenticator.interface.ts';
import { ProviderToken } from '../provider-token.model.ts';

/**
 * Authenticates a user by a sign-in at an OpenID Connect provider, which proves who signed in with a
 * signed ID token.
 *
 * Extend it once for every provider, naming the provider and the client registered there. The
 * sign-in itself runs through the routes of `AuthController`.
 */
export abstract class BaseOidcAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOAuthAuthenticator<RoleType, UserType>
    implements ProviderTokenAuthenticatorInterface<RoleType, UserType, FederatedCredentials> {
    /**
     * The provider's issuer url, eg. `https://accounts.google.com`, where it publishes what it is.
     */
    abstract override readonly issuer: string;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly scopes: string[] = ['openid', 'email', 'profile'];

    /**
     * The algorithms an ID token may be signed with.
     */
    readonly allowedAlgorithms: string[] = ['RS256', 'PS256', 'ES256', 'EdDSA'];

    // OpenID Connect's own way, which a provider honors only together with the consent prompt
    override readonly offlineAccess: OAuthOfflineAccess = { scopes: ['offline_access'], prompts: ['consent'], parameters: {} };

    /**
     * Which of the provider's tokens a request may send as its credential, read by
     * `ProviderTokenAuthStrategy`. None, when undefined.
     */
    readonly bearerTokens: OidcBearerTokens | undefined = undefined;

    /**
     * The keys the provider signs its tokens with, set up when a request first sends one and kept.
     */
    private keySet: JwtRemoteKeySet | undefined;

    private get httpClient(): HttpClientInterface {
        return inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    get acceptsProviderTokens(): boolean {
        return this.bearerTokens != undefined;
    }

    override init(app: ZibriApplication): void {
        super.init(app);
        if (
            this.bearerTokens != undefined
            && !this.bearerTokens.accessTokenAudiences.length
            && !this.bearerTokens.idTokenAudiences.length
        ) {
            throw new InternalError(
                `${this.constructor.name} takes bearer tokens for no audience: name the api's in accessTokenAudiences, or the clients' in idTokenAudiences.`
            );
        }
    }

    /**
     * Verifies a token of the provider a request sends as its credential, against the keys the provider
     * publishes, as `bearerTokens` says, and finds the user its identity is linked to for signing in.
     * @param token - The token.
     * @returns What it says, or undefined when it does not verify, is not taken, or names an identity
     * linked to nobody.
     * @throws When the provider cannot be reached to find out where it publishes its keys.
     */
    async findProviderToken(token: string): Promise<ProviderToken | undefined> {
        const bearerTokens: OidcBearerTokens | undefined = this.bearerTokens;
        if (bearerTokens == undefined) {
            return undefined;
        }
        const metadata: ServerMetadata = (await this.resolveConfiguration()).serverMetadata();
        if (metadata.jwks_uri == undefined) {
            return undefined;
        }
        this.keySet ??= JwtUtilities.createRemoteKeySet(
            metadata.jwks_uri,
            async (url, init) => await this.httpClient.fetchForLibrary(url, init)
        );
        const verified: EncodedJwt<JWTPayload> | undefined = await JwtUtilities.verifyProviderToken(token, this.keySet, {
            issuer: metadata.issuer,
            audiences: [...bearerTokens.accessTokenAudiences, ...bearerTokens.idTokenAudiences],
            algorithms: this.allowedAlgorithms
        });
        const cnf: unknown = verified?.payload['cnf'];
        const confirmation: JwtConfirmation | undefined = isJwtConfirmation(cnf) ? cnf : undefined;
        // a token bound to something not checked here is refused rather than taken as unbound
        if (
            verified?.payload.sub == undefined
            || !this.isTakenToken(verified, bearerTokens)
            || (cnf != undefined && confirmation == undefined)
        ) {
            return undefined;
        }
        // the issuer identities are stored with is the one the ID token of the sign-in named, which is
        // the one the token was verified against
        const identity: FederatedIdentity | undefined = await this.identityRepository.findOne({
            where: { issuer: metadata.issuer, subject: verified.payload.sub, signIn: true },
            required: false
        });
        if (identity == undefined) {
            return undefined;
        }
        const authTime: unknown = verified.payload['auth_time'];
        return {
            userId: identity.userId,
            authenticatedAt: typeof authTime === 'number' ? new Date(authTime * Ms.SECOND) : undefined,
            expiresAt: verified.payload.exp == undefined ? undefined : new Date(verified.payload.exp * Ms.SECOND),
            dpopKeyThumbprint: confirmation?.jkt,
            certificateThumbprint: confirmation?.['x5t#S256']
        };
    }

    /**
     * Reads what the registration of a new user gets from the claims of the provider's ID token.
     *
     * Override it for a provider that names these differently, or sends them next to the code.
     * @param claims - The verified claims of the ID token.
     * @param answer - Everything the provider sent the browser back with. Unlike the claims, nothing
     * signed it.
     * @returns The email, whether it is verified, and the names.
     */
    protected resolveProfile(
        claims: IDToken,
        // eslint-disable-next-line no-unused-vars
        answer: URLSearchParams
    ): FederatedProfile {
        return {
            email: this.findStringClaim(claims, 'email'),
            emailVerified: typeof claims['email_verified'] === 'boolean' ? claims['email_verified'] : undefined,
            name: this.findStringClaim(claims, 'name'),
            givenName: this.findStringClaim(claims, 'given_name'),
            familyName: this.findStringClaim(claims, 'family_name')
        };
    }

    protected override async createConfiguration(
        client: OpenIdClient,
        clientAuthentication: ClientAuth,
        requestOptions: DiscoveryRequestOptions
    ): Promise<Configuration> {
        return await client.discovery(new URL(this.issuer), this.clientId, undefined, clientAuthentication, requestOptions);
    }

    protected override getAuthorizationParameters(exchange: Pick<OAuthCodeExchange, 'nonce' | 'maxAgeInSeconds'>): Record<string, string> {
        return {
            nonce: exchange.nonce,
            // always sent, because it is what makes a provider say when the user signed in. A provider
            // that silently reused its session has not produced a fresh login, and the login time is
            // what a route accepting a recent login in place of a second factor reads
            max_age: String(exchange.maxAgeInSeconds)
        };
    }

    /**
     * Verifies the ID token - its signature against the provider's keys, its algorithm, issuer,
     * audience, expiry, nonce and login time.
     * @param answer - Everything the provider sent the browser back with.
     * @param exchange - What the answer is checked and exchanged with.
     * @returns Who the ID token says signed in and when, and the tokens.
     * @throws FederatedSignInError when the provider cannot be reached or the token cannot be verified.
     */
    protected override async resolveSignIn(answer: URLSearchParams, exchange: OAuthCodeExchange): Promise<OAuthProviderSignIn> {
        const tokens: TokenEndpointResponse & TokenEndpointResponseHelpers = await this.exchangeCode(answer, exchange, {
            expectedNonce: exchange.nonce,
            idTokenExpected: true,
            maxAge: exchange.maxAgeInSeconds
        });
        const claims: IDToken | undefined = tokens.claims();
        if (claims?.auth_time == undefined || !this.isSignedWithAllowedAlgorithm(tokens.id_token)) {
            throw new FederatedSignInError(FederatedSignInFailure.INVALID, { action: exchange.action });
        }
        return {
            identity: {
                issuer: claims.iss,
                subject: claims.sub,
                // the provider was asked for it with max_age, and the check above refuses a token without it
                authenticatedAt: new Date(claims.auth_time * 1000),
                profile: this.resolveProfile(claims, answer)
            },
            tokens
        };
    }

    /**
     * Whether the ID token is signed with one of the allowed algorithms.
     *
     * Checked on top of the verification, which accepts what the provider says it signs with: the
     * client metadata that would narrow that takes a single algorithm.
     * @param idToken - The ID token, verified already.
     * @returns True when its algorithm is allowed.
     */
    private isSignedWithAllowedAlgorithm(idToken: string | undefined): boolean {
        const header: string | undefined = idToken?.split('.')[0];
        if (header == undefined) {
            return false;
        }
        const parsed: unknown = JsonUtilities.parse<unknown>(Buffer.from(header, 'base64url').toString('utf8'));
        return typeof parsed === 'object' && parsed != undefined && 'alg' in parsed
            && typeof parsed.alg === 'string' && this.allowedAlgorithms.includes(parsed.alg);
    }

    /**
     * Whether a verified token is one `bearerTokens` takes: an access token for one of the api's
     * audiences, of the type it says, or an ID token for one of the clients.
     * @param verified - The token, verified already.
     * @param bearerTokens - Which tokens are taken.
     * @returns True when it is taken.
     */
    private isTakenToken(verified: EncodedJwt<JWTPayload>, bearerTokens: OidcBearerTokens): boolean {
        const audiences: string[] = typeof verified.payload.aud === 'string' ? [verified.payload.aud] : verified.payload.aud ?? [];
        // `application/at+jwt` is the same type written out in full, which RFC 9068 allows
        const isMarkedAccessToken: boolean = verified.header.typ?.toLowerCase().replace(/^application\//, '') === 'at+jwt';
        const isAccessToken: boolean = audiences.some(audience => bearerTokens.accessTokenAudiences.includes(audience))
            && (bearerTokens.accessTokenType === 'any' || isMarkedAccessToken);
        // a token marked as an access token is none of the ID tokens, whoever it is for
        const isIdToken: boolean = audiences.some(audience => bearerTokens.idTokenAudiences.includes(audience)) && !isMarkedAccessToken;
        return isAccessToken || isIdToken;
    }

    private findStringClaim(claims: IDToken, name: string): string | undefined {
        const value: unknown = claims[name];
        return typeof value === 'string' ? value : undefined;
    }
}