import type { AuthorizationCodeGrantChecks, ClientAuth, Configuration, DiscoveryRequestOptions, TokenEndpointResponse, TokenEndpointResponseHelpers } from 'openid-client';

import { OAuthClientAuthentication, OAuthClientSecret } from './oauth-client-authentication.model';
import { OAuthCodeExchange } from './oauth-code-exchange.model';
import { OAuthOfflineAccess } from './oauth-offline-access.model';
import { OAuthProviderLogin } from './oauth-provider-login.model';
import { OAuthProviderTokens, OAuthProviderTokensCreateData } from './oauth-provider-tokens.model';
import { OAuthResponseMode } from './oauth-response-mode.type';
import { OpenIdClient } from './open-id-client.type';
import { ZibriApplication } from '../../../application/application';
import { type AuditServiceInterface } from '../../../audit/audit-service.interface';
import { Repository } from '../../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { UniqueConstraintViolationError } from '../../../data-source/unique-constraint-violation.error';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { InternalError } from '../../../error-handling/internal-error.model';
import { type HttpClientInterface } from '../../../http-client/http-client.interface';
import { type LeaseServiceInterface } from '../../../leases/lease-service.interface';
import { AuditAction, AuditOutcome } from '../../../logging/audit-event.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Ms } from '../../../utilities/ms';
import { optionalPeer } from '../../../utilities/optional-peer.function';
import { UrlUtilities } from '../../../utilities/url.utilities';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { BaseUser } from '../../models/base-user.model';
import { BaseFederatedAuthenticator } from '../federated/base-federated.authenticator';
import { FederatedAnswerContext } from '../federated/federated-answer-context.model';
import { FederatedIdentity } from '../federated/federated-identity.model';
import { FederatedLoginFailure } from '../federated/federated-login-failure.enum';
import { FederatedLoginStart } from '../federated/federated-login-start.model';
import { FederatedLoginError } from '../federated/federated-login.error';
import { FederatedLogin } from '../federated/federated-login.model';
import { FederatedReauthentication } from '../federated/federated-reauthentication.model';
import { ProviderTokenGrant } from '../federated/provider-token-grant.model';
import { ProviderAccessAuthenticatorInterface } from '../provider-access-authenticator.interface';
import { ProviderAccessFailure } from '../provider-access-failure.enum';
import { ProviderAccessError } from '../provider-access.error';

/**
 * The codes `openid-client` refuses an answer of the provider with because checking it found it wrong.
 * Its other codes say the provider did not answer as an OAuth provider, such as with a gateway's page.
 */
const ANSWER_REFUSED_CODES: ReadonlySet<string> = new Set([
    'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
    'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED',
    'OAUTH_JWT_TIMESTAMP_CHECK_FAILED',
    'OAUTH_INVALID_RESPONSE',
    'OAUTH_PARSE_ERROR',
    'OAUTH_KEY_SELECTION_FAILED',
    'OAUTH_UNSUPPORTED_OPERATION'
]);

/**
 * How the provider is talked to, and when that was set up.
 */
type ReadConfiguration = {
    /**
     * The configuration, being set up or set up.
     */
    configuration: Promise<Configuration>,
    /**
     * When setting it up started, in milliseconds since the epoch.
     */
    readAtMs: number
};

/**
 * Authenticates a user by a login at an OAuth provider: the browser is sent there, and comes back with
 * a code the application exchanges for the provider's tokens.
 *
 * Extend `BaseOidcAuthenticator` for an OpenID Connect provider, or `BaseOAuth2Authenticator` for one
 * that speaks plain OAuth2. The login itself runs through the routes of `AuthController`.
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
     * The `prompt` that has the provider ask the user to log in again, even when it still has a session of theirs.
     */
    readonly reauthenticationPrompt: string = 'login';

    /**
     * How the provider is asked for a refresh token, when a login or a connection asks for scopes of
     * its apis. Nothing by default, since plain OAuth2 has no standard way to ask.
     */
    readonly offlineAccess: OAuthOfflineAccess = { scopes: [], prompts: [], parameters: {} };

    /**
     * How long before it expires a provider's access token is replaced, so it does not expire on its
     * way to the provider's api. One minute by default.
     */
    readonly accessTokenRefreshMarginInMs: number = Ms.MINUTE;

    /**
     * How long the provider's metadata is kept before it is read again. One day by default.
     */
    readonly metadataMaxAgeInMs: number = Ms.DAY;

    /**
     * How the provider is talked to, set up when first needed and again once `metadataMaxAgeInMs` passed.
     *
     * The promise rather than the value, so two logins starting together set it up once. Dropped when
     * setting it up failed and there is none from before, so the next login tries again rather than
     * failing for as long as the process lives.
     */
    private configuration: ReadConfiguration | undefined;

    private get tokensRepository(): Repository<OAuthProviderTokens, OAuthProviderTokensCreateData> {
        return inject(repositoryTokenFor(OAuthProviderTokens));
    }

    /**
     * What a provider's one-time things are spent through, across every instance.
     * @returns The lease service.
     */
    protected get leaseService(): LeaseServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    private get auditService(): AuditServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
    }

    override init(app: ZibriApplication): void {
        super.init(app);
        // only where tokens can be kept, so an application that only logs in declares nothing more
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
     * Deletes the identities of the given users at the provider, as the base does, and the tokens kept
     * for them first. Called in the transaction that deletes the users for good. Unlike an unlink, the
     * tokens are not handed back to the provider: that is a request to it, which a delete waits for
     * inside its transaction.
     * @param userIds - The users.
     * @param transaction - The transaction deleting them.
     */
    override async deleteUserRows(userIds: string[], transaction: RepositoryTransaction): Promise<void> {
        // only where tokens can be kept, as init declares them
        if (this.apiScopes.length) {
            const identities: FederatedIdentity[] = await this.findOwnIdentitiesOf(userIds, transaction);
            if (identities.length) {
                await this.tokensRepository.deleteAll({ identityId: { oneOf: identities.map(identity => identity.id) } }, { transaction });
            }
        }
        await super.deleteUserRows(userIds, transaction);
    }

    /**
     * Unlinks an identity at the provider from a user, so a login through it no longer logs in as them
     * and its apis are no longer called for them. The tokens kept for it are handed back to the provider.
     * @param userId - The user.
     * @param identityId - The id of the identity, as `findIdentities` answers with it.
     * @param transaction - The transaction to unlink in, if any.
     * @throws NotFoundError when the user has no identity of that id at the provider.
     */
    override async unlinkIdentity(userId: string, identityId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
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
     * identity that does not log in is unlinked, since it is linked for nothing else.
     *
     * The tokens are removed whether or not the provider can be reached to take them back.
     * @param userId - The user.
     * @param identityId - The id of the identity, as `findIdentities` answers with it.
     * @param transaction - The transaction to remove them in, if any.
     * @throws NotFoundError when the user has no identity of that id at the provider.
     */
    async revokeAccess(userId: string, identityId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        const identity: FederatedIdentity = await this.findOwnIdentity(userId, identityId, transaction);
        if (!identity.forLogin) {
            await this.unlinkUnusedIdentity(identity, transaction);
            return;
        }
        const tokens: OAuthProviderTokens | undefined = await this.removeTokens(identity, transaction);
        if (tokens != undefined) {
            await this.revokeAtProvider(tokens);
        }
    }

    /**
     * Stops an identity of a user from logging in as them, and keeps the tokens of its apis. An identity
     * without api access is unlinked, since it is linked for nothing else.
     *
     * Logging in is turned on again by connecting the identity again to log in.
     * @param userId - The user.
     * @param identityId - The id of the identity, as `findIdentities` answers with it.
     * @param transaction - The transaction to change it in, if any.
     * @throws NotFoundError when the user has no identity of that id at the provider.
     */
    async revokeLogin(userId: string, identityId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        const identity: FederatedIdentity = await this.findOwnIdentity(userId, identityId, transaction);
        if (!identity.grantedScopes.length) {
            await this.unlinkUnusedIdentity(identity, transaction);
            return;
        }
        if (!identity.forLogin) {
            return;
        }
        await this.identityRepository.updateById(identity.id, { forLogin: false }, { transaction });
        this.auditService.record({ action: AuditAction.IDENTITY_LOGIN_REVOKED, outcome: AuditOutcome.SUCCESS, userId: identity.userId }, transaction);
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
     * Has the provider prove who logged in, from its answer to a login this browser started.
     * @param answer - Everything the provider sent the browser back with.
     * @param exchange - What the answer is checked and exchanged with.
     * @returns Who logged in and when, and the tokens the code was exchanged for. Or that the user
     * logged in at the provider longer ago than `maxAgeInSeconds` allows, which starts the login
     * again asking the provider for a fresh one.
     * @throws FederatedLoginError when the provider cannot be reached or does not prove who logged in.
     */
    protected abstract resolveLogin(
        answer: URLSearchParams,
        exchange: OAuthCodeExchange
    ): Promise<OAuthProviderLogin | FederatedReauthentication>;

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
     * What a login asks the provider for on top of what every provider is asked: the code, the state,
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
     * @throws FederatedLoginError when the provider cannot be reached or the exchange is refused.
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
            throw new FederatedLoginError(FederatedLoginFailure.PROVIDER_ERROR, { cause: error, action: exchange.action });
        }
        try {
            // the callback url the application is configured with rather than the one the request
            // names: it is what the provider compares with the one the login started with
            return await client.authorizationCodeGrant(
                configuration,
                new URL(`${this.getCallbackUrl()}?${answer.toString()}`),
                { ...checks, pkceCodeVerifier: exchange.codeVerifier, expectedState: exchange.state }
            );
        }
        catch (error) {
            const failure: FederatedLoginFailure = this.resolveExchangeFailure(client, error);
            if (failure === FederatedLoginFailure.PROVIDER_ERROR) {
                // the provider not answering is a fault of somebody's to look at, and refusing it as a
                // forged answer showed an outage to the trail as a run of failed logins
                this.logger.warn(`${this.constructor.name} could not exchange the code at the provider.`, { error });
            }
            throw new FederatedLoginError(failure, { cause: error, action: exchange.action });
        }
    }

    /**
     * Resolves whether a failed exchange is an answer that is not good, or a provider that did not answer
     * as one.
     * @param client - The `openid-client` module.
     * @param error - What the exchange threw.
     * @returns `INVALID` for an answer refused as wrong, `PROVIDER_ERROR` for everything else.
     */
    private resolveExchangeFailure(client: OpenIdClient, error: unknown): FederatedLoginFailure {
        // the provider's own refusal, such as a code it already took or a verifier that does not match
        if (error instanceof client.ResponseBodyError) {
            return error.status < 500 ? FederatedLoginFailure.INVALID : FederatedLoginFailure.PROVIDER_ERROR;
        }
        if (error instanceof client.AuthorizationResponseError) {
            return FederatedLoginFailure.INVALID;
        }
        // what checking the answer found wrong with it: a claim, a signature, a state that is not the one
        // sent. What is left of the library's codes is a provider not answering in OAuth at all
        if (error instanceof client.ClientError && error.code != undefined && ANSWER_REFUSED_CODES.has(error.code)) {
            return FederatedLoginFailure.INVALID;
        }
        return FederatedLoginFailure.PROVIDER_ERROR;
    }

    /**
     * How the provider is talked to, set up when it is first needed and again once `metadataMaxAgeInMs`
     * passed. When setting it up again fails, the one from before is used until it can be.
     * @returns The configuration.
     * @throws When the provider cannot be reached to set it up, and it was never set up before.
     */
    protected async resolveConfiguration(): Promise<Configuration> {
        const previous: ReadConfiguration | undefined = this.configuration;
        if (previous != undefined && Date.now() - previous.readAtMs < this.metadataMaxAgeInMs) {
            return await previous.configuration;
        }
        // one reading for every login that needs it meanwhile
        const reading: ReadConfiguration = { configuration: this.setUpConfiguration(), readAtMs: Date.now() };
        this.configuration = reading;
        try {
            return await reading.configuration;
        }
        catch (error) {
            if (previous == undefined) {
                // only the reading that failed, not one a later login started meanwhile
                if (this.configuration === reading) {
                    this.configuration = undefined;
                }
                throw error;
            }
            this.logger.warn(
                `${this.constructor.name} could not read the metadata of the provider again, and uses what it read before.`,
                { error }
            );
            if (this.configuration === reading) {
                this.configuration = previous;
            }
            return await previous.configuration;
        }
    }

    /**
     * Loads `openid-client`, which is an optional peer.
     * @returns The module.
     * @throws When it is not installed.
     */
    protected resolveOpenIdClient(): OpenIdClient {
        return optionalPeer<OpenIdClient>('openid-client', 'Login through a provider');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async createLoginUrl(start: FederatedLoginStart): Promise<string> {
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
        // attempt holds nothing a reader of the database could finish the login with
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
    protected async verifyAnswer(
        answer: URLSearchParams,
        context: FederatedAnswerContext
    ): Promise<FederatedLogin | FederatedReauthentication> {
        const login: OAuthProviderLogin | FederatedReauthentication = await this.resolveLogin(answer, {
            state: context.state,
            codeVerifier: this.deriveFromBinding(context.binding, 'pkce'),
            nonce: this.deriveFromBinding(context.binding, 'nonce'),
            maxAgeInSeconds: Math.floor(context.maxAuthenticationAgeInMs / 1000),
            action: context.action
        });
        if ('reauthenticate' in login) {
            return login;
        }
        return {
            identity: login.identity,
            tokens: context.apiScopes.length ? this.toKeptTokens(login.tokens, context.apiScopes) : undefined,
            session: login.session
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected answersWithFormPost(): boolean {
        return this.responseMode === 'form_post';
    }

    protected override findProviderFailure(answer: URLSearchParams): FederatedLoginFailure | undefined {
        const error: string | null = answer.get('error');
        if (error == undefined) {
            return undefined;
        }
        return error === 'access_denied' ? FederatedLoginFailure.CANCELLED : FederatedLoginFailure.PROVIDER_ERROR;
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
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        await this.writeTokens(identity, tokens, transaction);
        this.auditService.record({
            action: AuditAction.PROVIDER_ACCESS_GRANTED,
            outcome: AuditOutcome.SUCCESS,
            userId: identity.userId,
            scopes: tokens.grantedScopes
        }, transaction);
    }

    private async findTokens(identityId: string, transaction: RepositoryTransaction | undefined): Promise<OAuthProviderTokens | undefined> {
        return await this.tokensRepository.findOne({ where: { identityId }, transaction, required: false });
    }

    /**
     * The scopes a login asks the provider for.
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
        transaction: RepositoryTransaction | undefined
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
     * Unlinks an identity left linked for nothing: neither logging in nor any api.
     * @param identity - The identity.
     * @param transaction - The transaction to unlink it in, if any.
     */
    private async unlinkUnusedIdentity(identity: FederatedIdentity, transaction: RepositoryTransaction | undefined): Promise<void> {
        await this.unlinkIdentity(identity.userId, identity.id, transaction);
        // recorded here, since the unlink of AuthService that records it is not the one that ran
        this.auditService.record({ action: AuditAction.IDENTITY_UNLINKED, outcome: AuditOutcome.SUCCESS, userId: identity.userId }, transaction);
    }

    /**
     * Stops keeping the tokens of an identity, and records that its apis can no longer be called.
     * @param identity - The identity.
     * @param transaction - The transaction to write in, if any.
     * @returns The tokens that were kept, to hand back to the provider. None when none were.
     */
    private async removeTokens(
        identity: FederatedIdentity,
        transaction: RepositoryTransaction | undefined
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
        this.auditService.record({
            action: AuditAction.PROVIDER_ACCESS_REVOKED,
            outcome: AuditOutcome.SUCCESS,
            userId: identity.userId,
            scopes: identity.grantedScopes
        }, transaction);
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
            || new Date(tokens.accessTokenExpirationDate).getTime() - this.accessTokenRefreshMarginInMs > Date.now();
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