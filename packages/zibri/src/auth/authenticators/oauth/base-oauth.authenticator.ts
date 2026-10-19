import type { AuthorizationCodeGrantChecks, ClientAuth, Configuration, DiscoveryRequestOptions, TokenEndpointResponse, TokenEndpointResponseHelpers } from 'openid-client';

import { OAuthClientAuthentication, OAuthClientSecret } from './oauth-client-authentication.model';
import { OAuthCodeExchange } from './oauth-code-exchange.model';
import { OAuthOfflineAccess } from './oauth-offline-access.model';
import { OAuthProviderSignIn } from './oauth-provider-sign-in.model';
import { OAuthProviderTokens, OAuthProviderTokensCreateData } from './oauth-provider-tokens.model';
import { OAuthResponseMode } from './oauth-response-mode.type';
import { OpenIdClient } from './open-id-client.type';
import { ZibriApplication } from '../../../application/application';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { UniqueConstraintViolationError } from '../../../data-source/unique-constraint-violation.error';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { InternalError } from '../../../error-handling/internal-error.model';
import { type HttpClientInterface } from '../../../http-client/http-client.interface';
import { type LeaseServiceInterface } from '../../../leases/lease-service.interface';
import { AuditAction, AuditOutcome } from '../../../logging/audit-event.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { optionalPeer } from '../../../utilities/optional-peer.function';
import { UrlUtilities } from '../../../utilities/url.utilities';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { BaseUser } from '../../models/base-user.model';
import { BaseFederatedAuthenticator } from '../federated/base-federated.authenticator';
import { FederatedAnswerContext } from '../federated/federated-answer-context.model';
import { FederatedIdentity } from '../federated/federated-identity.model';
import { FederatedSignInFailure } from '../federated/federated-sign-in-failure.enum';
import { FederatedSignInStart } from '../federated/federated-sign-in-start.model';
import { FederatedSignInError } from '../federated/federated-sign-in.error';
import { FederatedSignIn } from '../federated/federated-sign-in.model';
import { ProviderTokenGrant } from '../federated/provider-token-grant.model';
import { ProviderAccessAuthenticatorInterface } from '../provider-access-authenticator.interface';
import { ProviderAccessFailure } from '../provider-access-failure.enum';
import { ProviderAccessError } from '../provider-access.error';

/**
 * How long before it expires an access token is replaced, so it does not expire on its way to the
 * provider's api.
 */
const ACCESS_TOKEN_REFRESH_MARGIN_IN_MS: number = 60000;

/**
 * Authenticates a user by a sign-in at an OAuth provider: the browser is sent there, and comes back with
 * a code the application exchanges for the provider's tokens.
 *
 * Extend `BaseOidcAuthenticator` for an OpenID Connect provider, or `BaseOAuth2Authenticator` for one
 * that speaks plain OAuth2. The sign-in itself runs through the routes of `AuthController`.
 */
export abstract class BaseOAuthAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseFederatedAuthenticator<RoleType, UserType> implements ProviderAccessAuthenticatorInterface {
    /**
     * The id of the client registered at the provider.
     */
    abstract readonly clientId: string;

    /**
     * How the application proves to the provider which client it is.
     */
    abstract readonly clientAuthentication: OAuthClientAuthentication;

    /**
     * What the provider is asked to tell about the user.
     */
    abstract readonly scopes: string[];

    /**
     * How the provider sends its answer back.
     */
    readonly responseMode: OAuthResponseMode = 'query';

    /**
     * The `prompt` that has the provider ask the user to sign in again, rather than reuse its session.
     */
    readonly reauthenticationPrompt: string = 'login';

    /**
     * How the provider is asked for a refresh token, when a sign-in or a connection asks for scopes of
     * its apis. Nothing by default, since plain OAuth2 has no standard way to ask.
     */
    readonly offlineAccess: OAuthOfflineAccess = { scopes: [], prompts: [], parameters: {} };

    /**
     * How the provider is talked to, set up once and kept.
     *
     * The promise rather than the value, so two sign-ins starting together set it up once. Dropped when
     * setting it up failed, so the next sign-in tries again rather than failing for as long as the
     * process lives.
     */
    private configuration: Promise<Configuration> | undefined;

    private get tokensRepository(): Repository<OAuthProviderTokens, OAuthProviderTokensCreateData> {
        return inject(repositoryTokenFor(OAuthProviderTokens));
    }

    private get leaseService(): LeaseServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    override init(app: ZibriApplication): void {
        super.init(app);
        // only where tokens can be kept, so an application that only signs in declares nothing more
        if (this.apiScopes.length) {
            validateEntitiesRegistered(this.constructor.name, app, OAuthProviderTokens);
        }
        this.resolveOpenIdClient();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveFormPostOrigins(): Promise<string[]> {
        if (this.responseMode !== 'form_post') {
            return [];
        }
        const endpoint: string | undefined = (await this.resolveConfiguration()).serverMetadata().authorization_endpoint;
        return endpoint == undefined ? [] : [new URL(endpoint).origin];
    }

    /**
     * Unlinks an identity at the provider from a user, so a sign-in through it no longer logs in as them
     * and its apis are no longer called for them. The tokens kept for it are handed back to the provider.
     * @param userId - The user.
     * @param identityId - The id of the identity, as `findIdentities` answers with it.
     * @param transaction - The transaction to unlink in, if any.
     * @throws NotFoundError when the user has no identity of that id at the provider.
     */
    override async unlinkIdentity(userId: string, identityId: string, transaction: Transaction | undefined): Promise<void> {
        const identity: FederatedIdentity = await this.findOwnIdentity(userId, identityId, transaction);
        const tokens: OAuthProviderTokens | undefined = await this.removeTokens(identity, transaction);
        await super.unlinkIdentity(userId, identityId, transaction);
        if (tokens != undefined) {
            await this.revokeAtProvider(tokens);
        }
    }

    /**
     * Resolves an access token for calling the provider's apis for a user, with an identity of theirs.
     *
     * Asks the provider for a new one with the refresh token when the kept one has expired or is about
     * to, one request at a time for an identity across every instance.
     * @param userId - The user.
     * @param identityId - The id of the identity, as `findIdentities` answers with it.
     * @param scopes - The scopes the access token has to have been granted.
     * @returns The access token.
     * @throws NotFoundError when the user has no identity of that id at the provider.
     * @throws ProviderAccessError when no tokens are kept for the identity, they lack a scope, or no new
     * access token can be had.
     */
    async resolveAccessToken(userId: string, identityId: string, scopes: string[]): Promise<string> {
        const identity: FederatedIdentity = await this.findOwnIdentity(userId, identityId, undefined);
        if (!identity.grantedScopes.length) {
            throw new ProviderAccessError(ProviderAccessFailure.NOT_CONNECTED);
        }
        if (scopes.some(scope => !identity.grantedScopes.includes(scope))) {
            throw new ProviderAccessError(ProviderAccessFailure.MISSING_SCOPES);
        }
        const tokens: OAuthProviderTokens | undefined = await this.findTokens(identity.id, undefined);
        if (tokens == undefined) {
            throw new ProviderAccessError(ProviderAccessFailure.NOT_CONNECTED);
        }
        if (this.isFresh(tokens)) {
            return tokens.accessToken;
        }
        // one refresh at a time: a provider that rotates refresh tokens refuses the old one once it has
        // answered, so the second of two refreshes running together would lose the access for good
        const accessToken: string | undefined = await this.leaseService.withLease(
            { key: `oauth-tokens:${identity.id}`, leaseInMs: 30000, mode: 'wait', acquireTimeoutInMs: 15000, onCompletion: 'release' },
            async () => await this.refreshAccessToken(identity, tokens)
        );
        if (accessToken == undefined) {
            // 'wait' throws when it cannot take the lease rather than answering with nothing
            throw new InternalError(`The lease of the tokens of the identity ${identity.id} was neither taken nor refused.`);
        }
        return accessToken;
    }

    /**
     * Stops keeping the tokens of an identity of a user, and hands them back to the provider. An
     * identity that does not sign in is unlinked, since it is linked for nothing else.
     *
     * The tokens are removed whether or not the provider can be reached to take them back.
     * @param userId - The user.
     * @param identityId - The id of the identity, as `findIdentities` answers with it.
     * @param transaction - The transaction to remove them in, if any.
     * @throws NotFoundError when the user has no identity of that id at the provider.
     */
    async revokeAccess(userId: string, identityId: string, transaction: Transaction | undefined): Promise<void> {
        const identity: FederatedIdentity = await this.findOwnIdentity(userId, identityId, transaction);
        if (!identity.signIn) {
            await this.unlinkUnusedIdentity(identity, transaction);
            return;
        }
        const tokens: OAuthProviderTokens | undefined = await this.removeTokens(identity, transaction);
        if (tokens != undefined) {
            await this.revokeAtProvider(tokens);
        }
    }

    /**
     * Stops an identity of a user from signing in as them, and keeps the tokens of its apis. An identity
     * without api access is unlinked, since it is linked for nothing else.
     *
     * Signing in is turned on again by connecting the identity again to sign in.
     * @param userId - The user.
     * @param identityId - The id of the identity, as `findIdentities` answers with it.
     * @param transaction - The transaction to change it in, if any.
     * @throws NotFoundError when the user has no identity of that id at the provider.
     */
    async revokeSignIn(userId: string, identityId: string, transaction: Transaction | undefined): Promise<void> {
        const identity: FederatedIdentity = await this.findOwnIdentity(userId, identityId, transaction);
        if (!identity.grantedScopes.length) {
            await this.unlinkUnusedIdentity(identity, transaction);
            return;
        }
        if (!identity.signIn) {
            return;
        }
        await this.identityRepository.updateById(identity.id, { signIn: false }, { transaction });
        this.logger.audit({ action: AuditAction.IDENTITY_SIGN_IN_REVOKED, outcome: AuditOutcome.SUCCESS, userId: identity.userId });
    }

    /**
     * Sets up how the provider is talked to: where its endpoints are, and how the client proves itself
     * there.
     * @param client - `openid-client`.
     * @param clientAuthentication - How the client proves itself, ready for `openid-client`.
     * @param requestOptions - What every request to the provider goes through: the application's http
     * client, and plain http on the loopback interface.
     * @returns The configuration.
     */
    protected abstract createConfiguration(
        client: OpenIdClient,
        clientAuthentication: ClientAuth,
        requestOptions: DiscoveryRequestOptions
    ): Configuration | Promise<Configuration>;

    /**
     * Has the provider prove who signed in, from its answer to a sign-in this browser started.
     * @param answer - Everything the provider sent the browser back with.
     * @param exchange - What the answer is checked and exchanged with.
     * @returns Who signed in and when, and the tokens the code was exchanged for.
     * @throws FederatedSignInError when the provider cannot be reached or does not prove who signed in.
     */
    protected abstract resolveSignIn(answer: URLSearchParams, exchange: OAuthCodeExchange): Promise<OAuthProviderSignIn>;

    /**
     * Hands tokens back to the provider, so they stop working there as well.
     *
     * Hands back the refresh token, which ends the access tokens issued with it, or the access token
     * when there is none, at the revocation endpoint the provider publishes. Does nothing for a provider
     * that publishes none. Override it for a provider that takes tokens back some other way.
     * @param tokens - The tokens.
     * @throws When the provider cannot be reached or refuses.
     */
    protected async revokeTokens(tokens: Pick<OAuthProviderTokens, 'accessToken' | 'refreshToken'>): Promise<void> {
        const configuration: Configuration = await this.resolveConfiguration();
        if (configuration.serverMetadata().revocation_endpoint == undefined) {
            return;
        }
        await this.resolveOpenIdClient().tokenRevocation(configuration, tokens.refreshToken ?? tokens.accessToken);
    }

    /**
     * What a sign-in asks the provider for on top of what every provider is asked: the code, the state,
     * the PKCE challenge, the scopes and the callback.
     * @param exchange - What the answer will be checked with.
     * @returns The parameters of the authorization request.
     */
    protected getAuthorizationParameters(
        // eslint-disable-next-line unusedImports/no-unused-vars
        exchange: Pick<OAuthCodeExchange, 'nonce' | 'maxAgeInSeconds'>
    ): Record<string, string> {
        return {};
    }

    /**
     * Exchanges the code the provider answered with for its tokens, checking the state and the PKCE
     * verifier on the way.
     * @param answer - Everything the provider sent the browser back with.
     * @param exchange - What the answer is checked and exchanged with.
     * @param checks - What is checked on top, such as an ID token's nonce.
     * @returns The tokens.
     * @throws FederatedSignInError when the provider cannot be reached or the exchange is refused.
     */
    protected async exchangeCode(
        answer: URLSearchParams,
        exchange: OAuthCodeExchange,
        checks: Pick<AuthorizationCodeGrantChecks, 'expectedNonce' | 'idTokenExpected' | 'maxAge'>
    ): Promise<TokenEndpointResponse & TokenEndpointResponseHelpers> {
        const client: OpenIdClient = this.resolveOpenIdClient();
        let configuration: Configuration;
        try {
            configuration = await this.resolveConfiguration();
        }
        catch (error) {
            throw new FederatedSignInError(FederatedSignInFailure.PROVIDER_ERROR, { cause: error, action: exchange.action });
        }
        try {
            // the callback url the application is configured with rather than the one the request
            // names: it is what the provider compares with the one the sign-in started with
            return await client.authorizationCodeGrant(
                configuration,
                new URL(`${this.getCallbackUrl()}?${answer.toString()}`),
                { ...checks, pkceCodeVerifier: exchange.codeVerifier, expectedState: exchange.state }
            );
        }
        catch (error) {
            throw new FederatedSignInError(FederatedSignInFailure.INVALID, { cause: error, action: exchange.action });
        }
    }

    /**
     * How the provider is talked to, set up when it is first needed.
     * @returns The configuration.
     * @throws When the provider cannot be reached to set it up.
     */
    protected async resolveConfiguration(): Promise<Configuration> {
        // eslint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks
        this.configuration ??= this.setUpConfiguration().catch((error: unknown) => {
            this.configuration = undefined;
            throw error;
        });
        return await this.configuration;
    }

    /**
     * Loads `openid-client`, which is an optional peer.
     * @returns The module.
     * @throws When it is not installed.
     */
    protected resolveOpenIdClient(): OpenIdClient {
        return optionalPeer<OpenIdClient>('openid-client', 'Sign-in through a provider');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async createSignInUrl(start: FederatedSignInStart): Promise<string> {
        const client: OpenIdClient = this.resolveOpenIdClient();
        const configuration: Configuration = await this.resolveConfiguration();
        // a refresh token is what lets the apis be called while the user is away, so it is asked for
        // whenever they are
        const asksForApis: boolean = start.apiScopes.length > 0;
        const prompts: string[] = [
            ...start.reauthenticate ? [this.reauthenticationPrompt] : [],
            ...asksForApis ? this.offlineAccess.prompts : []
        ];
        // the verifier and the nonce are worked out from the cookie rather than stored, so the stored
        // attempt holds nothing a reader of the database could finish the sign-in with
        return client.buildAuthorizationUrl(configuration, {
            ...this.getAuthorizationParameters({
                nonce: this.deriveFromBinding(start.binding, 'nonce'),
                maxAgeInSeconds: Math.floor(start.maxAuthenticationAgeInMs / 1000)
            }),
            ...asksForApis ? this.offlineAccess.parameters : {},
            redirect_uri: this.getCallbackUrl(),
            scope: this.resolveRequestedScopes(start.apiScopes).join(' '),
            state: start.state,
            code_challenge: this.toCodeChallenge(this.deriveFromBinding(start.binding, 'pkce')),
            code_challenge_method: 'S256',
            ...prompts.length ? { prompt: [...new Set(prompts)].join(' ') } : {},
            ...this.responseMode === 'form_post' ? { response_mode: 'form_post' } : {}
        }).toString();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async verifyAnswer(answer: URLSearchParams, context: FederatedAnswerContext): Promise<FederatedSignIn> {
        const signIn: OAuthProviderSignIn = await this.resolveSignIn(answer, {
            state: context.state,
            codeVerifier: this.deriveFromBinding(context.binding, 'pkce'),
            nonce: this.deriveFromBinding(context.binding, 'nonce'),
            maxAgeInSeconds: Math.floor(context.maxAuthenticationAgeInMs / 1000),
            action: context.action
        });
        return {
            identity: signIn.identity,
            tokens: context.apiScopes.length ? this.toKeptTokens(signIn.tokens, context.apiScopes) : undefined
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected answersWithFormPost(): boolean {
        return this.responseMode === 'form_post';
    }

    protected override findProviderFailure(answer: URLSearchParams): FederatedSignInFailure | undefined {
        const error: string | null = answer.get('error');
        if (error == undefined) {
            return undefined;
        }
        return error === 'access_denied' ? FederatedSignInFailure.CANCELLED : FederatedSignInFailure.PROVIDER_ERROR;
    }

    /**
     * Keeps tokens for an identity, in place of any kept before, and records that its apis can be called.
     * @param identity - The identity.
     * @param tokens - The tokens.
     * @param transaction - The transaction to write in, if any.
     */
    protected override async keepProviderTokens(
        identity: FederatedIdentity,
        tokens: ProviderTokenGrant,
        transaction: Transaction | undefined
    ): Promise<void> {
        await this.writeTokens(identity, tokens, transaction);
        this.logger.audit({
            action: AuditAction.PROVIDER_ACCESS_GRANTED,
            outcome: AuditOutcome.SUCCESS,
            userId: identity.userId,
            scopes: tokens.grantedScopes
        });
    }

    private async findTokens(identityId: string, transaction: Transaction | undefined): Promise<OAuthProviderTokens | undefined> {
        return await this.tokensRepository.findOne({ where: { identityId }, transaction, required: false });
    }

    /**
     * The scopes a sign-in asks the provider for.
     * @param apiScopes - The scopes of the provider's apis it asks for on top.
     * @returns The authenticator's scopes, and with api scopes those and the scopes of offline access.
     */
    private resolveRequestedScopes(apiScopes: string[]): string[] {
        return apiScopes.length ? [...new Set([...this.scopes, ...apiScopes, ...this.offlineAccess.scopes])] : this.scopes;
    }

    /**
     * Reads the tokens to keep out of what the provider's token endpoint answered with.
     * @param response - The answer.
     * @param requestedScopes - The scopes that were asked for, which the provider granted when it names none.
     * @returns The tokens.
     */
    private toKeptTokens(response: TokenEndpointResponse, requestedScopes: string[]): ProviderTokenGrant {
        return {
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            accessTokenExpirationDate: response.expires_in == undefined ? undefined : new Date(Date.now() + (response.expires_in * 1000)),
            // the scopes are named only when they differ from what was asked for, such as when the user
            // left some out. Separated by spaces as OAuth2 has it, or by commas as GitHub sends them
            grantedScopes: response.scope == undefined
                ? requestedScopes
                : response.scope.split(/[\s,]+/).filter(scope => scope !== '')
        };
    }

    private async writeTokens(
        identity: FederatedIdentity,
        tokens: ProviderTokenGrant,
        transaction: Transaction | undefined
    ): Promise<void> {
        const kept: OAuthProviderTokens | undefined = await this.findTokens(identity.id, transaction);
        // a provider that issues no new refresh token keeps the one it issued before valid
        const refreshToken: string | undefined | null = tokens.refreshToken ?? kept?.refreshToken;
        const data: Pick<OAuthProviderTokens, 'accessToken' | 'refreshToken' | 'accessTokenExpirationDate'> = {
            accessToken: tokens.accessToken,
            refreshToken,
            accessTokenExpirationDate: tokens.accessTokenExpirationDate
        };
        if (kept == undefined) {
            try {
                await this.tokensRepository.create({ identityId: identity.id, ...data }, { transaction });
            }
            catch (error) {
                // kept in the meantime by a second answer for the same identity, which the newer
                // tokens replace
                if (!(error instanceof UniqueConstraintViolationError)) {
                    throw error;
                }
                const raced: OAuthProviderTokens | undefined = await this.findTokens(identity.id, transaction);
                if (raced == undefined) {
                    throw error;
                }
                await this.tokensRepository.updateById(raced.id, data, { transaction });
            }
        }
        else {
            await this.tokensRepository.updateById(kept.id, data, { transaction });
        }
        await this.identityRepository.updateById(identity.id, { grantedScopes: tokens.grantedScopes }, { transaction });
    }

    /**
     * Stops keeping the tokens of an identity, and records that its apis can no longer be called.
     * @param identity - The identity.
     * @param transaction - The transaction to write in, if any.
     * @returns The tokens that were kept, to hand back to the provider. None when none were.
     */
    /**
     * Unlinks an identity left linked for nothing: neither signing in nor any api.
     * @param identity - The identity.
     * @param transaction - The transaction to unlink it in, if any.
     */
    private async unlinkUnusedIdentity(identity: FederatedIdentity, transaction: Transaction | undefined): Promise<void> {
        await this.unlinkIdentity(identity.userId, identity.id, transaction);
        // recorded here, since the unlink of AuthService that records it is not the one that ran
        this.logger.audit({ action: AuditAction.IDENTITY_UNLINKED, outcome: AuditOutcome.SUCCESS, userId: identity.userId });
    }

    private async removeTokens(
        identity: FederatedIdentity,
        transaction: Transaction | undefined
    ): Promise<OAuthProviderTokens | undefined> {
        // read only for an identity that has some: without api scopes the tokens are not declared at all
        if (!identity.grantedScopes.length) {
            return undefined;
        }
        const tokens: OAuthProviderTokens | undefined = await this.findTokens(identity.id, transaction);
        if (tokens != undefined) {
            await this.tokensRepository.deleteById(tokens.id, { transaction });
        }
        await this.identityRepository.updateById(identity.id, { grantedScopes: [] }, { transaction });
        this.logger.audit({
            action: AuditAction.PROVIDER_ACCESS_REVOKED,
            outcome: AuditOutcome.SUCCESS,
            userId: identity.userId,
            scopes: identity.grantedScopes
        });
        return tokens;
    }

    /**
     * Asks the provider for a new access token with the refresh token, under the lease of the identity.
     * @param identity - The identity.
     * @param stale - The tokens as they were read before the lease was taken.
     * @returns The access token, which another request may have asked for while this one waited.
     * @throws ProviderAccessError when the tokens are gone, there is no refresh token, or the provider
     * refuses it.
     */
    private async refreshAccessToken(identity: FederatedIdentity, stale: OAuthProviderTokens): Promise<string> {
        // read again under the lease: whoever held it before may have refreshed them already. Told by
        // the token having changed rather than by it being fresh, since a provider may issue tokens
        // that live shorter than the margin they are replaced within
        const tokens: OAuthProviderTokens | undefined = await this.findTokens(identity.id, undefined);
        if (tokens == undefined) {
            throw new ProviderAccessError(ProviderAccessFailure.NOT_CONNECTED);
        }
        if (tokens.accessToken !== stale.accessToken) {
            return tokens.accessToken;
        }
        if (tokens.refreshToken == undefined) {
            throw new ProviderAccessError(ProviderAccessFailure.EXPIRED);
        }
        const client: OpenIdClient = this.resolveOpenIdClient();
        let response: TokenEndpointResponse;
        try {
            response = await client.refreshTokenGrant(await this.resolveConfiguration(), tokens.refreshToken);
        }
        catch (error) {
            // the user withdrew the access at the provider, or the refresh token lapsed: nothing kept is
            // good for anything any more. Anything else, such as the provider not answering, may pass
            if (error instanceof client.ResponseBodyError && error.error === 'invalid_grant') {
                await this.removeTokens(identity, undefined);
                throw new ProviderAccessError(ProviderAccessFailure.REVOKED, { cause: error });
            }
            throw error;
        }
        const refreshed: ProviderTokenGrant = this.toKeptTokens(response, identity.grantedScopes);
        await this.writeTokens(identity, refreshed, undefined);
        return refreshed.accessToken;
    }

    private isFresh(tokens: OAuthProviderTokens): boolean {
        return tokens.accessTokenExpirationDate == undefined
            || new Date(tokens.accessTokenExpirationDate).getTime() - ACCESS_TOKEN_REFRESH_MARGIN_IN_MS > Date.now();
    }

    /**
     * Hands tokens back to the provider, after they were removed here.
     *
     * A provider that cannot be reached does not undo the removal: the user asked for the access to
     * end, and the tokens are gone from here either way.
     * @param tokens - The tokens.
     */
    private async revokeAtProvider(tokens: OAuthProviderTokens): Promise<void> {
        try {
            await this.revokeTokens(tokens);
        }
        catch (error) {
            this.logger.warn(`${this.constructor.name} could not hand the tokens of an identity back to the provider.`, { error });
        }
    }

    private async setUpConfiguration(): Promise<Configuration> {
        const client: OpenIdClient = this.resolveOpenIdClient();
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
        return await this.createConfiguration(client, this.resolveClientAuth(client), {
            // through the application's http client, so a proxy or a CA bundle it is configured with
            // reaches the provider too
            [client.customFetch]: async (url, options) => await http.fetchForLibrary(url, {
                ...options,
                // copied into a buffer, which fetch takes: a Uint8Array may sit on a shared buffer,
                // which it does not
                body: options.body instanceof Uint8Array ? Buffer.from(options.body) : options.body
            }),
            // plain http only where nobody can listen in between, which is where a provider a test or
            // a local setup runs is reached
            // eslint-disable-next-line typescript/no-deprecated
            execute: UrlUtilities.isLoopback(new URL(this.issuer)) ? [client.allowInsecureRequests] : []
        });
    }

    private resolveClientAuth(client: OpenIdClient): ClientAuth {
        const authentication: OAuthClientAuthentication = this.clientAuthentication;
        switch (authentication.method) {
            case 'client_secret_basic':
            case 'client_secret_post': {
                const toClientAuth: (secret: string) => ClientAuth = authentication.method === 'client_secret_basic'
                    ? client.ClientSecretBasic
                    : client.ClientSecretPost;
                const secret: OAuthClientSecret = authentication.clientSecret;
                if (typeof secret === 'string') {
                    return toClientAuth(secret);
                }
                // resolved before every exchange rather than once: the configuration is kept for as long
                // as the process lives, and a signed secret expires. openid-client types this as
                // returning nothing, and hands it to oauth4webapi, which awaits it
                // eslint-disable-next-line typescript/no-misused-promises
                return async (as, metadata, body, headers) => {
                    toClientAuth(await secret())(as, metadata, body, headers);
                };
            }
            case 'private_key_jwt': {
                return client.PrivateKeyJwt(
                    authentication.keyId == undefined
                        ? authentication.privateKey
                        : { key: authentication.privateKey, kid: authentication.keyId }
                );
            }
        }
    }
}