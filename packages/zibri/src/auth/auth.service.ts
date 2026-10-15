import { AuthServiceInterface } from './auth-service.interface';
import { ZibriApplication } from '../application/application';
import { DefaultAuth } from '../application/application-options.model';
import { register } from '../di/register.function';
import { ReauthenticationRequiredError } from './2fa/reauthentication-required.error';
import { type TwoFactorServiceInterface } from './2fa/two-factor-service.interface';
import { AuthControllerUtilities } from './auth-controller/auth-controller.utilities';
import { AuthenticatorInterface } from './authenticators/authenticator.interface';
import { Authenticators } from './authenticators/authenticators.model';
import { ConnectionCompletingAuthenticatorInterface } from './authenticators/connection-completing-authenticator.interface';
import { FederatedAuthenticatorInterface } from './authenticators/federated/federated-authenticator.interface';
import { FederatedRouteUtilities } from './authenticators/federated/federated-route.utilities';
import { FederatedSessionMatch } from './authenticators/federated/federated-session-match.model';
import { FederatedSession } from './authenticators/federated/federated-session.model';
import { IdentityLinkingAuthenticatorInterface, isIdentityLinkingAuthenticator } from './authenticators/identity-linking-authenticator.interface';
import { IdentityLinkingAuthenticators } from './authenticators/identity-linking-authenticators.model';
import { LinkedIdentity } from './authenticators/linked-identity.model';
import { ConfirmPasswordResetData } from './authenticators/password/confirm-password-reset-data.model';
import { PasswordAuthenticator } from './authenticators/password/password.authenticator';
import { RequestPasswordResetData } from './authenticators/password/request-password-reset-data.model';
import { isProviderAccessAuthenticator, ProviderAccessAuthenticatorInterface } from './authenticators/provider-access-authenticator.interface';
import { ProviderAccessFailure } from './authenticators/provider-access-failure.enum';
import { ProviderAccessError } from './authenticators/provider-access.error';
import { Authentication } from './models/authentication.model';
import { BaseUser } from './models/base-user.model';
import { DeclaredRoleChecks } from './models/declared-role-checks.model';
import { HasRoleMetadata, SkipHasRoleMetadata } from './models/has-role-metadata.model';
import { IsLoggedInMetadata, SkipIsLoggedInMetadata } from './models/is-logged-in-metadata.model';
import { IsNotLoggedInMetadata, SkipIsNotLoggedInMetadata } from './models/is-not-logged-in-metadata.model';
import { LogoutResult } from './models/logout-result.model';
import { Require2faMetadata, SkipRequire2faMetadata } from './models/require-2fa-metadata.model';
import type { Require2faReauth, Require2faReauthOptions } from './models/require-2fa-reauth.model';
import { ResolvedAuthMetadata, ResolvedRouteAuth } from './models/resolved-auth-metadata.model';
import { RouteAuthConfiguration } from './models/route-auth-configuration.model';
import { SkipAuthMetadata } from './models/skip-auth-metadata.model';
import { ApiKeyClientAuthentication } from './strategies/api-key/api-key-client-authentication.model';
import { ApiKeyCreateData } from './strategies/api-key/api-key-create-data.model';
import { type ApiKeyServiceInterface } from './strategies/api-key/api-key-service.interface';
import { ApiKey } from './strategies/api-key/api-key.model';
import { CreatedApiKey } from './strategies/api-key/created-api-key.model';
import { AuthStrategies } from './strategies/auth-strategies.model';
import { AuthStrategyInterface } from './strategies/auth-strategy.interface';
import { CredentialLimits } from './strategies/credential-limits.model';
import { isLoginAuthStrategy, LoginAuthStrategyInterface } from './strategies/login-auth-strategy.interface';
import { type UserServiceInterface } from './user/user-service.interface';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Transaction } from '../data-source/transaction/transaction.model';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { ErrorUtilities } from '../error-handling/error.utilities';
import { AccountDeactivatedError } from '../error-handling/errors/account-deactivated.error';
import { AccountLockedError } from '../error-handling/errors/account-locked.error';
import { ForbiddenError } from '../error-handling/errors/forbidden.error';
import { InvalidDecoratorCombinationError } from '../error-handling/errors/invalid-decorator-combination.error';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../error-handling/errors/unauthorized.error';
import { BeforeAppInit } from '../global/before-app-init.interface';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppStart } from '../global/on-app-start.interface';
import { RouteRegistry } from '../global/route-registry/route.registry';
import { $ts } from '../localization/translate.function';
import { AuditAction, AuditOutcome, AuditReason } from '../logging/audit-event.model';
import { auditReasonFor } from '../logging/audit-reason-for.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { BaseMembership } from '../tenancy/membership/base-membership.model';
import { type MembershipServiceInterface } from '../tenancy/membership/membership-service.interface';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { type BaseWebsocketConnection } from '../websocket/models/connection/base-websocket-connection.model';
import { type WebsocketServiceInterface } from '../websocket/services/websocket-service.interface';

/**
 * The account a set of credentials names, as far as the framework can tell.
 *
 * Credentials are whatever the authenticator defined them to be, so this is a best effort: `email` is
 * the shape of a password, `username` the one of a directory, and credentials that identify their
 * users some other way record no subject rather than a wrong one.
 * @param credentials - Whatever was handed to the authenticator.
 * @returns The named account, or undefined if the credentials do not name one.
 */
function auditSubject(credentials: unknown): string | undefined {
    if (typeof credentials !== 'object' || credentials == undefined) {
        return undefined;
    }
    if ('email' in credentials && typeof credentials.email === 'string') {
        return credentials.email;
    }
    if ('username' in credentials && typeof credentials.username === 'string') {
        return credentials.username;
    }
    return undefined;
}

/**
 * The account a successful login turned out to be for.
 * @param authData - Whatever the strategy returned.
 * @returns The id of the account, or undefined if the returned data does not carry one.
 */
function auditUserId(authData: unknown): string | undefined {
    if (typeof authData !== 'object' || authData == undefined || !('userId' in authData)) {
        return undefined;
    }
    return typeof authData.userId === 'string' ? authData.userId : undefined;
}

const AUTH_SKIP_LABEL: string = '@Auth.skip';
const AUTH_IS_LOGGED_IN_LABEL: string = '@Auth.isLoggedIn';
const AUTH_IS_NOT_LOGGED_IN_LABEL: string = '@Auth.isNotLoggedIn';
const AUTH_HAS_ROLE_LABEL: string = '@Auth.hasRole';
const AUTH_HAS_PLATFORM_ROLE_LABEL: string = '@Auth.hasPlatformRole';
const AUTH_REQUIRE_2FA_LABEL: string = '@Auth.require2fa';

/**
 * Default auth service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class AuthService implements AuthServiceInterface, BeforeAppInit, OnAppInit, OnAppStart {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly strategies: AuthStrategies = [];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly authenticators: Authenticators = [];

    /**
     * What a route with no `@Auth` decorator of its own requires, as the application declared it.
     *
     * Left without a fallback on purpose: the option exists precisely because the framework does not
     * get to pick one.
     */
    private defaultAuth!: DefaultAuth;

    /**
     * Who each request is from, for as long as it is being handled.
     *
     * Keyed by the context so an entry is gone when the request is, and nothing has to clear it.
     */
    private readonly principals: WeakMap<
        HttpRequestContext | WebsocketRequestContext,
        Map<string, Promise<BaseUser<string> | undefined>>
    > = new WeakMap();

    // read when used rather than injected: only deactivating and reactivating a user need it
    private get userService(): UserServiceInterface {
        return inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    }

    private get apiKeyService(): ApiKeyServiceInterface {
        return inject(ZIBRI_DI_TOKENS.API_KEY_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    // read when used rather than injected, since the websocket service is built with this one
    private get websocketService(): WebsocketServiceInterface<BaseWebsocketConnection> {
        return inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
    }

    /**
     * The membership each request acts through, for as long as it is being handled, keyed like
     * principals and for the same reasons.
     */
    private readonly memberships: WeakMap<
        HttpRequestContext | WebsocketRequestContext,
        Map<string, Promise<BaseMembership<string> | undefined>>
    > = new WeakMap();

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE)
        private readonly twoFactorService: TwoFactorServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK)
        private readonly revalidateUsers: boolean,
        @Inject(ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH)
        private readonly defaultReauth: Require2faReauth,
        @Inject(ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH_WINDOW_IN_MS)
        private readonly defaultReauthWindowInMs: number
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    beforeAppInit(app: ZibriApplication): void {
        // before rather than on init, and this is the whole reason the hook is implemented at all:
        // what a route declared is resolved while the route is registered, and the router is
        // initialized before this service is. Read any later and every route would have been
        // resolved against a default the application had not stated yet.
        this.defaultAuth = app.options.defaultAuth;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        const { authenticators, authStrategies } = app.options;
        for (const authenticator of authenticators) {
            register({ token: authenticator, useClass: authenticator });
            this.authenticators.push(authenticator);
        }
        if (authenticators.length) {
            this.logger.info(
                `initializes ${authenticators.length} ${authenticators.length > 1 ? 'authenticators' : 'authenticator'}`
            );
            for (const authenticator of authenticators) {
                this.logger.info(`  - ${authenticator.name}`);
                await inject(authenticator).init?.(app);
            }
        }
        for (const strategy of authStrategies) {
            register({ token: strategy, useClass: strategy });
            this.strategies.push(strategy);
        }
        if (authStrategies.length) {
            this.logger.info(
                `initializes ${authStrategies.length} ${authStrategies.length > 1 ? 'auth strategies' : 'auth strategy'}`
            );
            for (const strategy of authStrategies) {
                this.logger.info(`  - ${strategy.name}`);
                await inject(strategy).init?.(app);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppStart(app: ZibriApplication): void {
        // on start rather than on init, once every strategy, authenticator and two factor method has
        // been initialized
        AuthControllerUtilities.validateControllers(app);
        // on start rather than on init: a route registered directly on the router after the
        // application initialized is one a provider may be sent back to as well
        for (const authenticator of FederatedRouteUtilities.findAuthenticators(this.authenticators)) {
            FederatedRouteUtilities.validateRouteUrls(authenticator);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async login<
        Role extends string,
        UserType extends BaseUser<Role>,
        CredentialsType,
        AuthDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        authenticator: Newable<AuthenticatorInterface<Role, UserType, CredentialsType>>,
        strategy: Newable<LoginAuthStrategyInterface<Role, UserType, AuthDataType, RefreshLoginDataType, LogoutDataType>>,
        credentials: CredentialsType,
        transaction: Transaction | undefined
    ): Promise<AuthDataType> {
        // recorded here rather than in the authenticators and strategies, so that custom ones are
        // audited without having to remember to be.
        //
        // The only way into a login: there is deliberately nothing that starts one for a user without
        // credentials an authenticator checked. Signing in at a provider, a one-time code, a
        // registration that has just created the user - each is a credential with an authenticator
        const subject: string | undefined = auditSubject(credentials);
        try {
            // the same transaction for both halves: a registration that has just linked an identity
            // inside it logs in with that identity, which nothing outside the transaction sees yet
            const authentication: Authentication<UserType> = await inject(authenticator).authenticate(credentials, transaction);
            // after the authenticator rather than inside each one, so that a password, a provider, a
            // directory and a passkey are all refused alike
            if (authentication.user.deactivatedAt != undefined) {
                throw new AccountDeactivatedError();
            }
            if (await this.twoFactorService.resolveLock(authentication.user) === 'account') {
                throw new AccountLockedError();
            }
            const authData: AuthDataType = await inject(strategy).startLogin(authentication, transaction);
            this.logger.audit({
                action: AuditAction.LOGIN,
                outcome: AuditOutcome.SUCCESS,
                subject,
                userId: authentication.user.id
            });
            return authData;
        }
        catch (error) {
            this.logger.audit({
                action: AuditAction.LOGIN,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                subject
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async refreshLogin<
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<LoginAuthStrategyInterface<Role, UserType, AuthDataType, RefreshLoginDataType, LogoutDataType>>,
        data: RefreshLoginDataType
    ): Promise<AuthDataType> {
        try {
            const authData: AuthDataType = await inject(strategy).refreshLogin(data);
            this.logger.audit({
                action: AuditAction.REFRESH_LOGIN,
                outcome: AuditOutcome.SUCCESS,
                userId: auditUserId(authData)
            });
            return authData;
        }
        catch (error) {
            // a refused refresh is only an expired or unknown credential here. The one that matters -
            // a credential presented after it was already exchanged - is recorded by the strategy
            // that detects it, because only it can tell reuse from expiry.
            this.logger.audit({
                action: AuditAction.REFRESH_LOGIN,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error)
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRegistration<
        Role extends string,
        UserType extends BaseUser<Role>,
        CredentialsType,
        TicketType,
        RegistrationType,
        IdentityType extends Pick<BaseEntity, 'id'>,
        ConnectionRequestType,
        ConnectionStartType
    >(
        authenticator: Newable<IdentityLinkingAuthenticatorInterface<
            Role, UserType, CredentialsType, TicketType, RegistrationType, IdentityType, ConnectionRequestType, ConnectionStartType
        >>,
        ticket: TicketType,
        transaction: Transaction | undefined
    ): Promise<RegistrationType> {
        return await inject(authenticator).resolveRegistration(ticket, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async linkIdentity<
        Role extends string,
        UserType extends BaseUser<Role>,
        CredentialsType,
        TicketType,
        RegistrationType,
        IdentityType extends Pick<BaseEntity, 'id'>,
        ConnectionRequestType,
        ConnectionStartType
    >(
        authenticator: Newable<IdentityLinkingAuthenticatorInterface<
            Role, UserType, CredentialsType, TicketType, RegistrationType, IdentityType, ConnectionRequestType, ConnectionStartType
        >>,
        ticket: TicketType,
        userId: string,
        transaction: Transaction | undefined
    ): Promise<void> {
        try {
            await inject(authenticator).linkIdentity(ticket, userId, transaction);
            this.logger.audit({ action: AuditAction.IDENTITY_LINKED, outcome: AuditOutcome.SUCCESS, userId });
        }
        catch (error) {
            this.logger.audit({
                action: AuditAction.IDENTITY_LINKED,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startConnection<
        Role extends string,
        UserType extends BaseUser<Role>,
        CredentialsType,
        TicketType,
        RegistrationType,
        IdentityType extends Pick<BaseEntity, 'id'>,
        ConnectionRequestType,
        ConnectionStartType
    >(
        authenticator: Newable<IdentityLinkingAuthenticatorInterface<
            Role, UserType, CredentialsType, TicketType, RegistrationType, IdentityType, ConnectionRequestType, ConnectionStartType
        >>,
        request: ConnectionRequestType
    ): Promise<ConnectionStartType> {
        // read from the request rather than taken as a parameter, so an identity is only ever connected
        // to the user who asked for it. Nothing is recorded yet: the identity is linked, or refused,
        // once the user has signed in with it
        const context: HttpRequestContext | WebsocketRequestContext | undefined
            = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (context == undefined) {
            throw new UnauthorizedError($ts`Could not resolve the currently logged in user.`);
        }
        const user: UserType = await this.getCurrentUser<Role, UserType, true>(context, this.strategies, true);
        return await inject(authenticator).startConnection(user.id, request);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async completeConnection<Role extends string, UserType extends BaseUser<Role>, CredentialsType, ConnectionAnswerType>(
        authenticator: Newable<ConnectionCompletingAuthenticatorInterface<Role, UserType, CredentialsType, ConnectionAnswerType>>,
        answer: ConnectionAnswerType
    ): Promise<void> {
        // the user of the request, for the reason startConnection reads it from there
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (context == undefined) {
            throw new UnauthorizedError($ts`Could not resolve the currently logged in user.`);
        }
        const user: UserType = await this.getCurrentUser<Role, UserType, true>(context, this.strategies, true);
        try {
            await inject(authenticator).completeConnection(user.id, answer);
            this.logger.audit({ action: AuditAction.IDENTITY_LINKED, outcome: AuditOutcome.SUCCESS, userId: user.id });
        }
        catch (error) {
            this.logger.audit({
                action: AuditAction.IDENTITY_LINKED,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                userId: user.id
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIdentities(userId: string, transaction: Transaction | undefined): Promise<LinkedIdentity[]>;
    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIdentities<IdentityType extends Pick<BaseEntity, 'id'>>(
        userId: string,
        transaction: Transaction | undefined,
        authenticators: IdentityLinkingAuthenticators<IdentityType>
    ): Promise<LinkedIdentity<IdentityType>[]>;
    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIdentities(
        userId: string,
        transaction: Transaction | undefined,
        authenticators: IdentityLinkingAuthenticators = this.findIdentityLinkingAuthenticators()
    ): Promise<LinkedIdentity[]> {
        const found: LinkedIdentity[][] = await Promise.all(authenticators.map(async authenticator => {
            const instance: InstanceType<IdentityLinkingAuthenticators[number]> = inject(authenticator);
            return (await instance.findIdentities(userId, transaction)).map(identity => ({ authenticator: instance.name, identity }));
        }));
        return found.flat();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unlinkIdentity(userId: string, identityId: string, transaction: Transaction | undefined): Promise<void> {
        try {
            const holder: InstanceType<IdentityLinkingAuthenticators[number]>
                = await this.resolveIdentityHolder(userId, identityId, transaction);
            await holder.unlinkIdentity(userId, identityId, transaction);
            this.logger.audit({ action: AuditAction.IDENTITY_UNLINKED, outcome: AuditOutcome.SUCCESS, userId });
        }
        catch (error) {
            this.logger.audit({
                action: AuditAction.IDENTITY_UNLINKED,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveProviderAccessToken(userId: string, identityId: string, scopes: string[]): Promise<string> {
        // no transaction on purpose: a refresh writes the provider's new tokens, and a provider that
        // rotates its refresh token has refused the old one by then. Rolled back with the caller's
        // work, the access would be lost for good
        const holder: ProviderAccessAuthenticatorInterface = await this.resolveProviderAccessHolder(userId, identityId, undefined);
        return await holder.resolveAccessToken(userId, identityId, scopes);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revokeProviderAccess(userId: string, identityId: string, transaction: Transaction | undefined): Promise<void> {
        try {
            const holder: ProviderAccessAuthenticatorInterface = await this.resolveProviderAccessHolder(userId, identityId, transaction);
            // the success is recorded by the authenticator, which records every end of an access the
            // same way, also one the provider refused
            await holder.revokeAccess(userId, identityId, transaction);
        }
        catch (error) {
            this.logger.audit({
                action: AuditAction.PROVIDER_ACCESS_REVOKED,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createApiKey<Role extends string>(
        userId: string,
        data: ApiKeyCreateData<Role, undefined>,
        transaction: Transaction | undefined
    ): Promise<CreatedApiKey>;
    // eslint-disable-next-line jsdoc/require-jsdoc
    async createApiKey<Role extends string>(
        userId: string,
        data: ApiKeyCreateData<Role, ApiKeyClientAuthentication>,
        transaction: Transaction | undefined
    ): Promise<ApiKey>;
    // eslint-disable-next-line jsdoc/require-jsdoc
    async createApiKey<Role extends string>(
        userId: string,
        data: ApiKeyCreateData<Role>,
        transaction: Transaction | undefined
    ): Promise<CreatedApiKey | ApiKey> {
        try {
            const clientAuthentication: ApiKeyClientAuthentication | undefined = data.clientAuthentication;
            const created: CreatedApiKey | ApiKey = clientAuthentication == undefined
                ? await this.apiKeyService.create(userId, { ...data, clientAuthentication }, transaction)
                : await this.apiKeyService.createClient(userId, { ...data, clientAuthentication }, transaction);
            // a key is a way into the account for as long as it lives, including for whoever made it
            // after getting in some other way, which is why its creation is worth a line of its own
            this.logger.audit({ action: AuditAction.API_KEY_CREATED, outcome: AuditOutcome.SUCCESS, userId });
            return created;
        }
        catch (error) {
            this.logger.audit({
                action: AuditAction.API_KEY_CREATED,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findApiKeys(userId: string, transaction: Transaction | undefined): Promise<ApiKey[]> {
        return await this.apiKeyService.findForUser(userId, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revokeApiKey(userId: string, apiKeyId: string, transaction: Transaction | undefined): Promise<void> {
        await this.auditApiKeyRevocation(userId, async () => await this.apiKeyService.revoke(userId, apiKeyId, transaction));
        await this.websocketService.disconnectEndedLogins([userId], transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revokeApiKeys(userId: string, transaction: Transaction | undefined): Promise<void> {
        await this.auditApiKeyRevocation(userId, async () => await this.apiKeyService.revokeForUser(userId, transaction));
        await this.websocketService.disconnectEndedLogins([userId], transaction);
    }

    /**
     * Revokes api keys of a user, and records it.
     * @param userId - The id of the user.
     * @param revoke - Revokes them.
     */
    private async auditApiKeyRevocation(userId: string, revoke: () => Promise<void>): Promise<void> {
        try {
            await revoke();
            this.logger.audit({ action: AuditAction.API_KEY_REVOKED, outcome: AuditOutcome.SUCCESS, userId });
        }
        catch (error) {
            this.logger.audit({
                action: AuditAction.API_KEY_REVOKED,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deactivateUser(userId: string, transaction: Transaction | undefined): Promise<void> {
        await this.auditUserChange(AuditAction.USER_DEACTIVATED, userId, async () => {
            await this.userService.updateDeactivatedAt(userId, new Date(), transaction);
            await this.endLogins(userId, transaction);
            // gone for good rather than paused: a key handed to a script outlives the reason the user
            // was deactivated, and reactivating them should not quietly bring it back
            await this.apiKeyService.revokeForUser(userId, transaction);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async reactivateUser(userId: string, transaction: Transaction | undefined): Promise<void> {
        await this.auditUserChange(AuditAction.USER_REACTIVATED, userId, async () => {
            // null rather than undefined: it clears the column
            // eslint-disable-next-line unicorn/no-null
            await this.userService.updateDeactivatedAt(userId, null, transaction);
        });
    }

    /**
     * Changes a user, and records it.
     * @param action - What is recorded.
     * @param userId - The id of the user.
     * @param change - Changes them.
     */
    private async auditUserChange(action: AuditAction, userId: string, change: () => Promise<void>): Promise<void> {
        try {
            await change();
            this.logger.audit({ action, outcome: AuditOutcome.SUCCESS, userId });
        }
        catch (error) {
            this.logger.audit({ action, outcome: AuditOutcome.FAILURE, reason: auditReasonFor(error), userId });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveStrategies<Capable extends AuthStrategyInterface<string, BaseUser<string>>>(
        hasCapability: (strategy: AuthStrategyInterface<string, BaseUser<string>>) => strategy is Capable
    ): Capable[] {
        return this.strategies.map(s => inject(s)).filter(s => hasCapability(s));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async getCurrentUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        B extends boolean = true
    >(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        required: B
    ): Promise<B extends false ? UserType | undefined : UserType> {
        // deliberately not short circuited on the CURRENT_USER token. That token is resolved for
        // whatever the route asked for, and answering a call that named different strategies with it
        // hands back a user the caller said it would not accept - and skips the `required` check
        // below, so a route declaring it needs a user could be handed undefined instead of a 401.
        // The memo underneath keys on what the answer depends on, which is the same saving without
        // the confusion.
        //
        // the same resolution the checks run, so a route that already established who this is does
        // not read the account again to hand it to the handler. Always the authoritative one: a
        // handler asking for the current user wants the row, not what a credential claims about it.
        const currentUser: UserType | undefined = await this.memoized(
            context,
            `resolved:${allowedStrategies.map(s => s.name).join(',')}`,
            async () => await this.readResolvedUser(context, allowedStrategies)
        ) as UserType | undefined;
        if (currentUser === undefined && required) {
            throw new UnauthorizedError($ts`Could not resolve the currently logged in user.`);
        }
        return currentUser as B extends false ? UserType | undefined : UserType;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestPasswordReset<Role extends string, UserType extends BaseUser<Role>>(
        data: RequestPasswordResetData<Role, UserType>
    ): Promise<void> {
        // deliberately not audited here. A reset is only requested *through* this method when the
        // address turned out to belong to somebody, so an event recorded here would be missing
        // exactly the requests worth watching - the ones probing addresses that do not exist. The
        // controllers record the request instead, where every request is still visible.
        await inject(PasswordAuthenticator).requestPasswordReset(data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isPasswordResetTokenValid(resetToken: string): Promise<boolean> {
        return await inject(PasswordAuthenticator).isPasswordResetTokenValid(resetToken);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPasswordReset(data: ConfirmPasswordResetData): Promise<void> {
        try {
            const userId: string = await inject(PasswordAuthenticator).confirmPasswordReset(data);
            // in every strategy rather than the one whose controller took the request: whoever the
            // reset is meant to lock out may hold a login of any of them
            await this.endLogins(userId, data.transaction);
            this.logger.audit({ action: AuditAction.PASSWORD_RESET_CONFIRMED, outcome: AuditOutcome.SUCCESS, userId });
        }
        catch (error) {
            // no subject: the request carries a reset token and a new password, and nothing that
            // names an account. Guessing tokens is what this event is for.
            this.logger.audit({
                action: AuditAction.PASSWORD_RESET_CONFIRMED,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error)
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async checkAccess(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        // read rather than resolved: the route's declaration cannot have changed since it was
        // registered, and resolving one warns and refuses along the way
        const { metadata, requiresLogin }: ResolvedRouteAuth = RouteRegistry.get(controllerClass, controllerMethod).auth;
        await this.runChecks(metadata, requiresLogin, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveRouteAuth(controllerClass: Newable<unknown>, controllerMethod: string): ResolvedRouteAuth {
        const metadata: ResolvedAuthMetadata = {
            isLoggedIn: this.resolveIsLoggedInMetadata(controllerClass, controllerMethod),
            isNotLoggedIn: this.resolveIsNotLoggedInMetadata(controllerClass, controllerMethod),
            hasRole: this.resolveHasRoleMetadata(controllerClass, controllerMethod),
            hasPlatformRole: this.resolveHasPlatformRoleMetadata(controllerClass, controllerMethod),
            require2fa: this.resolveRequire2faMetadata(controllerClass, controllerMethod)
        };
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(controllerClass, controllerMethod);
        const controllerSkip: SkipAuthMetadata | undefined = MetadataUtilities.getControllerSkipAuth(controllerClass);

        this.warnAboutRedundantSkips(controllerClass, controllerMethod, routeSkip, controllerSkip);

        return {
            metadata,
            requiresLogin: this.requiresLoginFor(controllerClass, controllerMethod, metadata, routeSkip, controllerSkip)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async checkRouteAccess(
        auth: RouteAuthConfiguration | undefined,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        // the same gate a controller route goes through, reached with the two halves already known
        // rather than read off a class that does not exist here
        const metadata: ResolvedAuthMetadata = this.toResolvedAuthMetadata(auth);
        await this.runChecks(metadata, this.requiresLoginGiven(metadata, this.defaultAuthAppliesTo(auth)), context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    requiresRouteAuthentication(auth: RouteAuthConfiguration | undefined): boolean {
        return this.requiresLoginGiven(this.toResolvedAuthMetadata(auth), this.defaultAuthAppliesTo(auth));
    }

    private findIdentityLinkingAuthenticators(): IdentityLinkingAuthenticators {
        return this.authenticators.filter(
            (authenticator): authenticator is IdentityLinkingAuthenticators[number] => isIdentityLinkingAuthenticator(inject(authenticator))
        );
    }

    /**
     * Finds the authenticator an identity of a user is linked through, so a caller needs nothing but
     * the id findIdentities answered with.
     * @param userId - The user.
     * @param identityId - The id of the identity.
     * @param transaction - The transaction to read in, if any.
     * @returns The authenticator.
     * @throws NotFoundError when the user has no identity of that id.
     */
    private async resolveIdentityHolder(
        userId: string,
        identityId: string,
        transaction: Transaction | undefined
    ): Promise<InstanceType<IdentityLinkingAuthenticators[number]>> {
        const holders: InstanceType<IdentityLinkingAuthenticators[number]>[] = this.findIdentityLinkingAuthenticators()
            .map(authenticator => inject(authenticator));
        const held: boolean[] = await Promise.all(holders.map(async holder => {
            const identities: Pick<BaseEntity, 'id'>[] = await holder.findIdentities(userId, transaction);
            return identities.some(identity => identity.id === identityId);
        }));
        const holder: InstanceType<IdentityLinkingAuthenticators[number]> | undefined = holders.find((_, index) => held[index] === true);
        if (holder == undefined) {
            throw new NotFoundError($ts`The user has no such identity.`);
        }
        return holder;
    }

    /**
     * Finds the authenticator that keeps the tokens of an identity of a user.
     * @param userId - The user.
     * @param identityId - The id of the identity.
     * @param transaction - The transaction to read in, if any.
     * @returns The authenticator.
     * @throws NotFoundError when the user has no identity of that id.
     * @throws ProviderAccessError when the authenticator of the identity keeps no tokens.
     */
    private async resolveProviderAccessHolder(
        userId: string,
        identityId: string,
        transaction: Transaction | undefined
    ): Promise<ProviderAccessAuthenticatorInterface> {
        const holder: InstanceType<IdentityLinkingAuthenticators[number]>
            = await this.resolveIdentityHolder(userId, identityId, transaction);
        if (!isProviderAccessAuthenticator(holder)) {
            throw new ProviderAccessError(ProviderAccessFailure.NOT_CONNECTED);
        }
        return holder;
    }

    /**
     * Reads a route's declaration into the shape the checks are written against.
     * @param auth - What the route declared, if anything.
     * @returns The five checks, each present only where the route asked for it.
     */
    private toResolvedAuthMetadata(auth: RouteAuthConfiguration | undefined): ResolvedAuthMetadata {
        return {
            isLoggedIn: auth?.isLoggedIn,
            isNotLoggedIn: auth?.isNotLoggedIn,
            hasRole: auth?.hasRole,
            hasPlatformRole: auth?.hasPlatformRole,
            require2fa: auth?.require2fa
        };
    }

    /**
     * Whether the application's default requirement reaches a manually registered route.
     * @param auth - What the route declared, if anything.
     * @returns True when the route has not opted out of it.
     */
    private defaultAuthAppliesTo(auth: RouteAuthConfiguration | undefined): boolean {
        return this.defaultAuth === 'requireLogin' && auth?.skip !== true;
    }

    /**
     * Runs the checks a route declared, in the order a caller meets them.
     *
     * Shared by both kinds of route on purpose. What a route says differs - decorators on a class, a
     * configuration object on a manually registered one - but what saying it *means* must not, or a
     * route would be protected by which way it was written down.
     * @param metadata - What the route resolved to.
     * @param requiresLogin - Whether a caller has to be authenticated, default included.
     * @param context - The request being checked.
     * @throws When one of the checks refuses the caller.
     */
    private async runChecks(
        metadata: ResolvedAuthMetadata,
        requiresLogin: boolean,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        const isLoggedInMetadata: IsLoggedInMetadata | undefined = metadata.isLoggedIn;
        const isNotLoggedInMetadata: IsNotLoggedInMetadata | undefined = metadata.isNotLoggedIn;
        const hasRoleMetadata: HasRoleMetadata | undefined = metadata.hasRole;
        const hasPlatformRoleMetadata: HasRoleMetadata | undefined = metadata.hasPlatformRole;
        const require2faMetadata: Require2faMetadata | undefined = metadata.require2fa;

        // isLoggedIn
        if (
            requiresLogin
            && !await this.isLoggedIn(context, isLoggedInMetadata?.allowedStrategies ?? this.strategies)
        ) {
            await this.auditDenied(context, isLoggedInMetadata?.allowedStrategies ?? this.strategies, AuditReason.NOT_LOGGED_IN);
            throw new UnauthorizedError($ts`You need to be logged in to access this route.`);
        }
        // isNotLoggedIn
        if (
            isNotLoggedInMetadata
            && await this.isLoggedIn(context, isNotLoggedInMetadata.allowedStrategies ?? this.strategies)
        ) {
            await this.auditDenied(context, isNotLoggedInMetadata.allowedStrategies ?? this.strategies, AuditReason.ALREADY_LOGGED_IN);
            throw new ForbiddenError($ts`You cannot be logged in when accessing this route.`);
        }

        // membership - on every route rather than only on those naming a role: a logged in caller
        // acts in the tenant the request is for, and a public route reading that tenant's rows is no
        // reason to let somebody who does not belong to it read them
        if (!await this.isMemberOfActiveTenant(context)) {
            await this.auditDenied(context, this.strategies, AuditReason.NOT_A_MEMBER);
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }

        // hasRole
        if (
            hasRoleMetadata
            && !await this.hasRole(context, hasRoleMetadata.allowedStrategies ?? this.strategies, hasRoleMetadata.allowedRoles)
        ) {
            await this.auditDenied(context, hasRoleMetadata.allowedStrategies ?? this.strategies, AuditReason.MISSING_ROLE);
            // which roles open a route is the authorization model, and the caller who just proved
            // they hold none of them is the last one it should be described to - walking the routes
            // with any account at all would otherwise map which role guards which endpoint. The
            // audit event above keeps the distinction, named and attributed, where it is useful
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }

        // hasPlatformRole
        if (
            hasPlatformRoleMetadata
            && !await this.hasPlatformRole(
                context,
                hasPlatformRoleMetadata.allowedStrategies ?? this.strategies,
                hasPlatformRoleMetadata.allowedRoles
            )
        ) {
            await this.auditDenied(context, hasPlatformRoleMetadata.allowedStrategies ?? this.strategies, AuditReason.MISSING_ROLE);
            // worded like the refusal above, for the reason given there
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }

        // require2fa
        if (require2faMetadata) {
            const user: BaseUser<string> = await this.getCurrentUser(context, this.strategies, true);
            try {
                await this.validate2faOrReauth(user, context, require2faMetadata);
            }
            catch (error) {
                // the refusal is passed on as it is rather than replaced by one message, so the caller
                // learns whether to type a code, wait for the next one or wait before trying again
                if (ErrorUtilities.isRefusal(error)) {
                    this.logger.audit({
                        action: AuditAction.AUTHORIZATION,
                        outcome: AuditOutcome.FAILURE,
                        reason: AuditReason.SECOND_FACTOR_MISSING,
                        userId: user.id
                    });
                }
                throw error;
            }
        }

        // ownership is not checked here at all. It is declared on the entity as a `scope` and
        // enforced by the repository, which is the only place that sees the queries a handler
        // actually runs - a check here could only cover the routes that name a single row in their
        // path, which left every list endpoint to filter itself and one forgotten filter to be a
        // cross-account leak.
    }

    /**
     * Lets a request through \@Auth.require2fa: on a second factor, or on a recent login where the
     * route accepts one in place of it.
     * @param user - The user the request was resolved to.
     * @param context - The request being checked.
     * @param metadata - What the route declared.
     * @throws When neither is there, with what the caller should be told.
     */
    private async validate2faOrReauth(
        user: BaseUser<string>,
        context: HttpRequestContext | WebsocketRequestContext,
        metadata: Require2faMetadata
    ): Promise<void> {
        const reauth: Require2faReauthOptions | undefined = this.toReauthOptions(metadata.reauth ?? this.defaultReauth);
        // a recent login does not stand in for a second factor that is locked: whoever was guessing at
        // it holds exactly such a login, and the lock would otherwise be a way around itself
        if (reauth == undefined || await this.twoFactorService.resolveLock(user) != undefined) {
            await this.twoFactorService.validate2fa(user, context, metadata.allowedMethods);
            return;
        }
        // a fallback only stands in for a factor the user does not have. Asked before the login time,
        // because a user who has one is asked for it however recently they logged in
        if (reauth.allow === 'onlyAsFallback' && await this.twoFactorService.isRegistered(user, metadata.allowedMethods)) {
            await this.twoFactorService.validate2fa(user, context, metadata.allowedMethods);
            return;
        }
        if (await this.hasLoggedInWithin(context, reauth.windowInMs ?? this.defaultReauthWindowInMs)) {
            return;
        }
        // too long ago. A user who holds a factor can still present it, and its refusal says what was
        // wrong with the one they sent; a user who holds none can only log in again, and being asked
        // for a code would send them looking for something they do not have
        if (reauth.allow === true && await this.twoFactorService.isRegistered(user, metadata.allowedMethods)) {
            await this.twoFactorService.validate2fa(user, context, metadata.allowedMethods);
            return;
        }
        throw new ReauthenticationRequiredError();
    }

    /**
     * Reads a route's reauth setting into its long form.
     * @param reauth - What the route declared, or the application's default.
     * @returns The long form, or undefined when a recent login is not accepted.
     */
    private toReauthOptions(reauth: Require2faReauth): Require2faReauthOptions | undefined {
        if (reauth === false) {
            return undefined;
        }
        return typeof reauth === 'object' ? reauth : { allow: reauth };
    }

    /**
     * Whether the caller logged in no longer ago than the given window.
     * @param context - The request being checked.
     * @param windowInMs - How long ago the login may have been.
     * @returns False as well when the strategy cannot say when its caller logged in.
     */
    private async hasLoggedInWithin(context: HttpRequestContext | WebsocketRequestContext, windowInMs: number): Promise<boolean> {
        // the strategy the request addresses, which is the one the user was just resolved by
        const authenticatedAt: Date | undefined = await this.strategyFor(context, this.strategies)?.resolveAuthenticatedAt(context);
        return authenticatedAt != undefined && Date.now() - authenticatedAt.getTime() <= windowInMs;
    }

    /**
     * Records that a route refused a caller.
     *
     * Only denials. A line per allowed request would be an access log, which is a different thing
     * with a different volume, and burying the refusals in it would defeat the purpose.
     * @param context - The request that was refused.
     * @param allowedStrategies - The strategies the failed check was willing to accept.
     * @param reason - Which check said no.
     */
    private async auditDenied(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        reason: AuditReason
    ): Promise<void> {
        // resolvePrincipal is memoized per request, so naming who was refused costs nothing beyond
        // the lookup the check that refused them already did
        const principal: BaseUser<string> | undefined = await this.resolvePrincipal(context, allowedStrategies);
        this.logger.audit({
            action: AuditAction.AUTHORIZATION,
            outcome: AuditOutcome.FAILURE,
            reason,
            userId: principal?.id
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isLoggedIn(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<boolean> {
        // the IS_LOGGED_IN token answers for the route's strategies, and this is asked with a set
        // per check - so reading it here would answer "logged in" for a credential the caller
        // excluded. resolvePrincipal memoizes per strategy set instead.
        return await this.resolvePrincipal(context, allowedStrategies) != undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async hasRole(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        allowedRoles: string[]
    ): Promise<boolean> {
        const membership: BaseMembership<string> | undefined = await this.resolveMembership(context, allowedStrategies);
        return membership?.roles.some(r => allowedRoles.includes(r)) ?? false;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async hasPlatformRole(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        allowedRoles: string[]
    ): Promise<boolean> {
        const principal: BaseUser<string> | undefined = await this.resolvePrincipal(context, allowedStrategies);
        if (!principal) {
            return false;
        }
        return principal.roles.some(r => allowedRoles.includes(r));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async getCurrentMembership<
        Role extends string,
        MembershipType extends BaseMembership<Role>,
        B extends boolean = true
    >(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        required: B
    ): Promise<B extends false ? MembershipType | undefined : MembershipType> {
        const membership: BaseMembership<string> | undefined = await this.resolveMembership(context, allowedStrategies);
        if (membership == undefined && required) {
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }
        return membership as B extends false ? MembershipType | undefined : MembershipType;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveCredentialTenant(context: HttpRequestContext | WebsocketRequestContext): Promise<string | undefined> {
        // every strategy, for the reason isMemberOfActiveTenant gives
        const limits: CredentialLimits | undefined = await this.strategyFor(context, this.strategies)?.resolveCredentialLimits?.(context);
        return limits?.tenantId;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveCredentialExpiry(context: HttpRequestContext | WebsocketRequestContext): Promise<Date | undefined> {
        return await this.strategyFor(context, this.strategies)?.resolveExpiresAt(context);
    }

    /**
     * Whether the caller of a request may act in the tenant it is for.
     * @param context - The request being checked.
     * @returns True when no tenant is active, when nobody is logged in, or when the logged in user is
     * a member of the tenant through the credential they sent.
     */
    private async isMemberOfActiveTenant(context: HttpRequestContext | WebsocketRequestContext): Promise<boolean> {
        if (this.tenantService.getActiveTenantId() == undefined) {
            return true;
        }
        // every strategy rather than the ones the route names: whoever the request carries a
        // credential of acts in the tenant, whichever of them the route goes on to accept
        if (await this.resolvePrincipal(context, this.strategies) == undefined) {
            return true;
        }
        return await this.resolveMembership(context, this.strategies) != undefined;
    }

    /**
     * Resolves the membership a request acts through in the active tenant, once per request.
     * @param context - The request to resolve for.
     * @param allowedStrategies - The strategies that may answer who the request is from.
     * @returns The membership, its roles narrowed to what the credential may use, or undefined when no
     * tenant is active, nobody is logged in, the user is no member of the tenant or the credential is
     * bound to another one.
     */
    private async resolveMembership(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseMembership<string> | undefined> {
        const perRequest: Map<string, Promise<BaseMembership<string> | undefined>> = this.memberships.get(context)
            ?? new Map<string, Promise<BaseMembership<string> | undefined>>();
        this.memberships.set(context, perRequest);

        const key: string = allowedStrategies.map(s => s.name).join(',');
        const pending: Promise<BaseMembership<string> | undefined> | undefined = perRequest.get(key);
        if (pending) {
            return await pending;
        }
        const resolving: Promise<BaseMembership<string> | undefined> = this.readMembership(context, allowedStrategies);
        perRequest.set(key, resolving);
        return await resolving;
    }

    private async readMembership(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseMembership<string> | undefined> {
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        const principal: BaseUser<string> | undefined = await this.resolvePrincipal(context, allowedStrategies);
        if (tenantId == undefined || principal == undefined) {
            return undefined;
        }
        const limits: CredentialLimits | undefined = await this.strategyFor(context, allowedStrategies)?.resolveCredentialLimits?.(context);
        if (limits?.tenantId != undefined && limits.tenantId !== tenantId) {
            return undefined;
        }
        const membership: BaseMembership<string> | undefined = await this.membershipService.findMembership(principal.id, tenantId);
        if (membership == undefined || limits == undefined) {
            return membership;
        }
        // narrowed on the membership itself, for the reason the api key strategy narrows the user: a
        // handler reading the roles of the current membership sees what the credential may do too
        return { ...membership, roles: membership.roles.filter(role => limits.roles.includes(role)) };
    }

    /**
     * Refuses a controller that both declares a check and skips everything.
     *
     * The route level pair - `@Auth.isLoggedIn()` beside `@Auth.skip()` on the same method - has
     * always been a hard error, and the class level one only became expressible when `@Auth.skip`
     * gained a class form. Left undetected it resolves in favour of the check, so the skip reads
     * like it opens the controller and does nothing at all.
     * @param controllerClass - The controller to check.
     * @param controllerMetadata - The controller level check, if it declared one. Only its presence
     * matters here.
     * @param label - How to name that check in the error.
     * @throws When the controller carries both.
     */
    private validateControllerSkipDoesNotConflict(
        controllerClass: Newable<unknown>,
        controllerMetadata: object | undefined,
        label: string
    ): void {
        if (controllerMetadata && MetadataUtilities.getControllerSkipAuth(controllerClass)) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [label, AUTH_SKIP_LABEL]);
        }
    }

    /**
     * Warns about a skip that skips nothing.
     *
     * Only reachable under a `'public'` default: with `'requireLogin'` there is always something to
     * skip, because the skip is what makes the route public. A controller shipped by a library
     * cannot know which default the application picked and has to state its posture either way,
     * which is what `allowRedundant` is for.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The route to check.
     * @param routeSkip - The skip on the route, if it has one.
     * @param controllerSkip - The skip on the controller, if it has one.
     */
    private warnAboutRedundantSkips(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        routeSkip: SkipAuthMetadata | undefined,
        controllerSkip: SkipAuthMetadata | undefined
    ): void {
        if (
            this.defaultAuth !== 'public'
            || MetadataUtilities.getControllerIsLoggedIn(controllerClass)
            || MetadataUtilities.getControllerIsNotLoggedIn(controllerClass)
            || MetadataUtilities.getControllerHasRole(controllerClass)
            || MetadataUtilities.getControllerHasPlatformRole(controllerClass)
            || MetadataUtilities.getControllerRequire2fa(controllerClass)
        ) {
            return;
        }
        if (routeSkip && !routeSkip.allowRedundant) {
            this.logger.warn(`Useless @Auth.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (controllerSkip && !controllerSkip.allowRedundant) {
            this.logger.warn(`Useless @Auth.skip on controller ${controllerClass.name}`);
        }
    }

    /**
     * Whether a route that carries no auth decorators of its own falls back to the application wide
     * default - the one decision the framework refuses to make on its own.
     *
     * A skip is how a route says "nothing" on purpose rather than by omission, and
     * `@Auth.isLoggedIn.skip` counts as one: it exists to undo a login requirement, so letting the
     * application wide requirement survive it would quietly turn that decorator into a no-op.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The route to check.
     * @param routeSkip - The skip on the route, if it has one.
     * @param controllerSkip - The skip on the controller, if it has one.
     * @returns Whether the route requires a logged in user because the application said so.
     */
    private defaultAuthApplies(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        routeSkip: SkipAuthMetadata | undefined,
        controllerSkip: SkipAuthMetadata | undefined
    ): boolean {
        return this.defaultAuth === 'requireLogin'
            && !routeSkip
            && !controllerSkip
            && !MetadataUtilities.getRouteSkipIsLoggedIn(controllerClass, controllerMethod)
            && !MetadataUtilities.getControllerSkipIsLoggedIn(controllerClass);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    requiresAuthentication(controllerClass: Newable<unknown>, controllerMethod: string): boolean {
        return RouteRegistry.get(controllerClass, controllerMethod).auth.requiresLogin;
    }

    /**
     * The login gate, for metadata that has already been resolved.
     *
     * The single answer to "does a caller have to authenticate", shared by the runtime check and by
     * whoever describes the route to the outside. Not the same question as "does it carry an auth
     * decorator": under a `'requireLogin'` default a route that carries nothing requires a login too,
     * and answering the wrong one of those documented every undecorated route as public.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The route to check.
     * @param metadata - What the route resolved to.
     * @param routeSkip - The skip on the route, if it has one.
     * @param controllerSkip - The skip on the controller, if it has one.
     * @returns Whether a caller has to be logged in.
     */
    private requiresLoginFor(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        metadata: ResolvedAuthMetadata,
        routeSkip: SkipAuthMetadata | undefined,
        controllerSkip: SkipAuthMetadata | undefined
    ): boolean {
        return this.requiresLoginGiven(
            metadata,
            this.defaultAuthApplies(controllerClass, controllerMethod, routeSkip, controllerSkip)
        );
    }

    /**
     * The login gate once both halves of it are known.
     *
     * Split out from the metadata lookup so a route that carries its declaration as data reaches the
     * same answer as one that carries it as decorators. Only *where the default applies* is read
     * differently; what the declaration means is decided once, here.
     * @param metadata - What the route resolved to.
     * @param defaultApplies - Whether the application's `defaultAuth` reaches this route.
     * @returns Whether a caller has to be logged in.
     */
    private requiresLoginGiven(metadata: ResolvedAuthMetadata, defaultApplies: boolean): boolean {
        if (metadata.isLoggedIn || metadata.hasRole || metadata.hasPlatformRole || metadata.require2fa) {
            return true;
        }
        if (metadata.isNotLoggedIn) {
            // it says the opposite, and it says it itself - a route only reachable while logged out
            // is not one the default requirement applies to
            return false;
        }
        return defaultApplies;
    }

    /**
     * Resolves who the request is from, once per request.
     *
     * Every check is the same question about the same caller, so it is asked once: a route requiring
     * a login, a role and ownership resolved three times over before this. Keyed by the strategies
     * allowed for the check as well as by the request, because a route may narrow which of them
     * count - the same request with two different lists is two different questions.
     *
     * The authoritative answer is shared with getCurrentUser, which asks for exactly the same thing,
     * so a handler taking the current user does not pay for a second read of it.
     * @param context - The request to resolve for.
     * @param allowedStrategies - The strategies that may answer.
     * @returns Who the request is from, or undefined when no strategy recognizes it.
     */
    private async resolvePrincipal(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseUser<string> | undefined> {
        // a claimed principal is a different value than a resolved one, so the two never share an
        // entry - only the checks may take the claimed one, and getCurrentUser must not
        const key: string = `${this.revalidateUsers ? 'resolved' : 'claimed'}:${allowedStrategies.map(s => s.name).join(',')}`;
        return await this.memoized(context, key, async () => await this.readPrincipal(context, allowedStrategies));
    }

    /**
     * Runs the given resolution once per request, however often it is asked for.
     * @param context - The request the answer belongs to.
     * @param key - What is being resolved, including whatever it depends on.
     * @param resolve - Produces the answer when it is not known yet.
     * @returns The answer.
     */
    private async memoized(
        context: HttpRequestContext | WebsocketRequestContext,
        key: string,
        resolve: () => Promise<BaseUser<string> | undefined>
    ): Promise<BaseUser<string> | undefined> {
        const perRequest: Map<string, Promise<BaseUser<string> | undefined>> = this.principals.get(context)
            ?? new Map<string, Promise<BaseUser<string> | undefined>>();
        this.principals.set(context, perRequest);

        const pending: Promise<BaseUser<string> | undefined> | undefined = perRequest.get(key);
        if (pending) {
            return await pending;
        }
        const resolving: Promise<BaseUser<string> | undefined> = resolve();
        perRequest.set(key, resolving);
        return await resolving;
    }

    private async readPrincipal(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseUser<string> | undefined> {
        const strategy: AuthStrategyInterface<string, BaseUser<string>> | undefined = this.strategyFor(context, allowedStrategies);
        if (!strategy) {
            return undefined;
        }
        // the account, unless this deployment said it would rather trust the credential. A strategy
        // that cannot name a caller without reading does not offer the second one, and stays
        // authoritative whatever the setting says.
        if (this.revalidateUsers || strategy.resolveClaimedUser == undefined) {
            return this.withoutDeactivated(await strategy.resolveUser(context));
        }
        // a claim carries no deactivation, so a deactivated user's access token works until it
        // expires when the deployment trusts the credential; their logins have ended, so it is not
        // refreshed
        return await strategy.resolveClaimedUser(context);
    }

    private async readResolvedUser(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseUser<string> | undefined> {
        return this.withoutDeactivated(await this.strategyFor(context, allowedStrategies)?.resolveUser(context));
    }

    /**
     * Drops a user that is deactivated, so that no request acts as them.
     * @param user - The user a strategy resolved, if any.
     * @returns The user, or undefined when there was none or they are deactivated.
     */
    private withoutDeactivated(user: BaseUser<string> | undefined): BaseUser<string> | undefined {
        return user?.deactivatedAt == undefined ? user : undefined;
    }

    /**
     * The one strategy a request addresses.
     *
     * Chosen by which credential is present rather than by asking every strategy to resolve, so a
     * request costs one lookup instead of one per registered strategy.
     * @param context - The request to look at.
     * @param allowedStrategies - The strategies that may answer.
     * @returns The strategy, or undefined when the request carries no credential any of them knows.
     * @throws When the request carries several, which names several callers.
     */
    private strategyFor(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): AuthStrategyInterface<string, BaseUser<string>> | undefined {
        // the registered strategies a route's list names, a class extending one of them included: a
        // route naming ApiKeyAuthStrategy is meant for api keys, whichever subclass reads them
        const strategies: AuthStrategyInterface<string, BaseUser<string>>[] = this.strategies
            .filter(registered => allowedStrategies.some(allowed => registered === allowed || registered.prototype instanceof allowed))
            .map(s => inject(s))
            .filter(s => s.hasCredential(context));

        if (strategies.length > 1) {
            // a request addressing two strategies at once names two callers, and any pick between
            // them is arbitrary. Picking one is how a request ends up authorized as the stronger
            // identity while acting as the weaker: a browser attaches its session cookie to
            // everything, so whoever supplies the second credential decides which half of that pair
            // a route sees. Refused instead, before anything is read.
            throw new UnauthorizedError(
                $ts`This request carries more than one credential (${strategies.map(s => s.name).join(', ')}). Send exactly one.`
            );
        }
        return strategies[0];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveIsLoggedInMetadata(controllerClass: Newable<unknown>, controllerMethod: string): IsLoggedInMetadata | undefined {
        const controllerIsLoggedIn: IsLoggedInMetadata | undefined = MetadataUtilities.getControllerIsLoggedIn(controllerClass);
        const routeIsLoggedIn: IsLoggedInMetadata | undefined = MetadataUtilities.getRouteIsLoggedIn(
            controllerClass,
            controllerMethod
        );
        const controllerSkipIsLoggedIn: SkipIsLoggedInMetadata | undefined = MetadataUtilities.getControllerSkipIsLoggedIn(controllerClass);
        const routeSkipIsLoggedIn: SkipIsLoggedInMetadata | undefined = MetadataUtilities.getRouteSkipIsLoggedIn(
            controllerClass,
            controllerMethod
        );
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeIsLoggedIn && routeSkip) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_IS_LOGGED_IN_LABEL, AUTH_SKIP_LABEL]
            );
        }
        if (routeIsLoggedIn && routeSkipIsLoggedIn) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_IS_LOGGED_IN_LABEL, '@Auth.isLoggedIn.skip']
            );
        }
        if (controllerIsLoggedIn && controllerSkipIsLoggedIn) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [AUTH_IS_LOGGED_IN_LABEL, '@Auth.isLoggedIn.skip']);
        }
        this.validateControllerSkipDoesNotConflict(controllerClass, controllerIsLoggedIn, AUTH_IS_LOGGED_IN_LABEL);

        // the same condition @Auth.skip's warning hangs off, and for the same reason: under a
        // `requireLogin` default there is always a login to skip, so this decorator is what makes the
        // route reachable rather than a leftover. The other four per check skips stay unconditional -
        // none of them say anything about a login, so none of them become meaningful.
        if (this.defaultAuth === 'public' && !routeIsLoggedIn && !controllerIsLoggedIn && routeSkipIsLoggedIn) {
            this.logger.warn(`Useless @Auth.isLoggedIn.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (this.defaultAuth === 'public' && !controllerIsLoggedIn && controllerSkipIsLoggedIn) {
            this.logger.warn(`Useless @Auth.isLoggedIn.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipIsLoggedIn || routeSkip) {
            return undefined;
        }
        if (routeIsLoggedIn) {
            return routeIsLoggedIn;
        }
        if (controllerSkipIsLoggedIn) {
            return undefined;
        }
        return controllerIsLoggedIn;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveIsNotLoggedInMetadata(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): IsNotLoggedInMetadata | undefined {
        const controllerIsNotLoggedIn: IsNotLoggedInMetadata | undefined = MetadataUtilities.getControllerIsNotLoggedIn(controllerClass);
        const routeIsNotLoggedIn: IsNotLoggedInMetadata | undefined = MetadataUtilities.getRouteIsNotLoggedIn(
            controllerClass,
            controllerMethod
        );
        const controllerSkipIsNotLoggedIn: SkipIsNotLoggedInMetadata | undefined
            = MetadataUtilities.getControllerSkipIsNotLoggedIn(controllerClass);
        const routeSkipIsNotLoggedIn: SkipIsNotLoggedInMetadata | undefined = MetadataUtilities.getRouteSkipIsNotLoggedIn(
            controllerClass,
            controllerMethod
        );
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeIsNotLoggedIn && routeSkip) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_IS_NOT_LOGGED_IN_LABEL, AUTH_SKIP_LABEL]
            );
        }
        if (routeIsNotLoggedIn && routeSkipIsNotLoggedIn) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_IS_NOT_LOGGED_IN_LABEL, '@Auth.isNotLoggedIn.skip']
            );
        }
        if (controllerIsNotLoggedIn && controllerSkipIsNotLoggedIn) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [AUTH_IS_NOT_LOGGED_IN_LABEL, '@Auth.isNotLoggedIn.skip']);
        }
        this.validateControllerSkipDoesNotConflict(controllerClass, controllerIsNotLoggedIn, AUTH_IS_NOT_LOGGED_IN_LABEL);

        if (!routeIsNotLoggedIn && !controllerIsNotLoggedIn && routeSkipIsNotLoggedIn) {
            this.logger.warn(`Useless @Auth.isNotLoggedIn.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerIsNotLoggedIn && controllerSkipIsNotLoggedIn) {
            this.logger.warn(`Useless @Auth.isNotLoggedIn.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipIsNotLoggedIn || routeSkip) {
            return undefined;
        }
        if (routeIsNotLoggedIn) {
            return routeIsNotLoggedIn;
        }
        if (controllerSkipIsNotLoggedIn) {
            return undefined;
        }
        return controllerIsNotLoggedIn;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveHasRoleMetadata(controllerClass: Newable<unknown>, controllerMethod: string): HasRoleMetadata | undefined {
        return this.resolveRoleMetadata(controllerClass, controllerMethod, AUTH_HAS_ROLE_LABEL, {
            controller: MetadataUtilities.getControllerHasRole(controllerClass),
            route: MetadataUtilities.getRouteHasRole(controllerClass, controllerMethod),
            controllerSkip: MetadataUtilities.getControllerSkipHasRole(controllerClass),
            routeSkip: MetadataUtilities.getRouteSkipHasRole(controllerClass, controllerMethod)
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveHasPlatformRoleMetadata(controllerClass: Newable<unknown>, controllerMethod: string): HasRoleMetadata | undefined {
        return this.resolveRoleMetadata(controllerClass, controllerMethod, AUTH_HAS_PLATFORM_ROLE_LABEL, {
            controller: MetadataUtilities.getControllerHasPlatformRole(controllerClass),
            route: MetadataUtilities.getRouteHasPlatformRole(controllerClass, controllerMethod),
            controllerSkip: MetadataUtilities.getControllerSkipHasPlatformRole(controllerClass),
            routeSkip: MetadataUtilities.getRouteSkipHasPlatformRole(controllerClass, controllerMethod)
        });
    }

    /**
     * Resolves what a role check declared on a route and its controller means, with the skips
     * applied - the same for a role in the tenant and a role of the user's own.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The route to resolve.
     * @param label - How the decorator is named in errors and warnings.
     * @param declared - What the route and its controller declare.
     * @returns The check that applies, or undefined when none does.
     * @throws When a check and a skip of it are declared together.
     */
    private resolveRoleMetadata(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        label: string,
        declared: DeclaredRoleChecks
    ): HasRoleMetadata | undefined {
        const controllerHasRole: HasRoleMetadata | undefined = declared.controller;
        const routeHasRole: HasRoleMetadata | undefined = declared.route;
        const controllerSkipHasRole: SkipHasRoleMetadata | undefined = declared.controllerSkip;
        const routeSkipHasRole: SkipHasRoleMetadata | undefined = declared.routeSkip;
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeHasRole && routeSkip) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [label, AUTH_SKIP_LABEL]
            );
        }

        if (routeHasRole && routeSkipHasRole) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [label, `${label}.skip`]
            );
        }
        if (controllerHasRole && controllerSkipHasRole) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [label, `${label}.skip`]);
        }
        this.validateControllerSkipDoesNotConflict(controllerClass, controllerHasRole, label);

        if (!routeHasRole && !controllerHasRole && routeSkipHasRole) {
            this.logger.warn(`Useless ${label}.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerHasRole && controllerSkipHasRole) {
            this.logger.warn(`Useless ${label}.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipHasRole || routeSkip) {
            return undefined;
        }
        if (routeHasRole) {
            return routeHasRole;
        }
        if (controllerSkipHasRole) {
            return undefined;
        }
        return controllerHasRole;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveRequire2faMetadata(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): Require2faMetadata | undefined {
        const controllerRequire2fa: Require2faMetadata | undefined = MetadataUtilities.getControllerRequire2fa(
            controllerClass
        );
        const routeRequire2fa: Require2faMetadata | undefined = MetadataUtilities.getRouteRequire2fa(
            controllerClass,
            controllerMethod
        );
        const controllerSkipRequire2fa: SkipRequire2faMetadata | undefined = MetadataUtilities.getControllerSkipRequire2fa(controllerClass);
        const routeSkipRequire2fa: SkipRequire2faMetadata | undefined = MetadataUtilities.getRouteSkipRequire2fa(
            controllerClass,
            controllerMethod
        );
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeRequire2fa && routeSkip) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`, [AUTH_REQUIRE_2FA_LABEL, AUTH_SKIP_LABEL]
            );
        }
        if (routeRequire2fa && routeSkipRequire2fa) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_REQUIRE_2FA_LABEL, '@Auth.require2fa.skip']
            );
        }
        if (controllerRequire2fa && controllerSkipRequire2fa) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [AUTH_REQUIRE_2FA_LABEL, '@Auth.require2fa.skip']);
        }
        this.validateControllerSkipDoesNotConflict(controllerClass, controllerRequire2fa, AUTH_REQUIRE_2FA_LABEL);

        if (!routeRequire2fa && !controllerRequire2fa && routeSkipRequire2fa) {
            this.logger.warn(`Useless @Auth.require2fa.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerRequire2fa && controllerSkipRequire2fa) {
            this.logger.warn(`Useless @Auth.require2fa.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipRequire2fa || routeSkip) {
            return undefined;
        }
        if (routeRequire2fa) {
            return routeRequire2fa;
        }
        if (controllerSkipRequire2fa) {
            return undefined;
        }
        return controllerRequire2fa;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endLogins(userId: string, transaction: Transaction | undefined): Promise<void> {
        await Promise.all(this.findLoginStrategies().map(async strategy => await strategy.endLogins(userId, transaction)));
        // after the strategies, so that what a socket is checked against is what they left
        await this.websocketService.disconnectEndedLogins([userId], transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endFederatedLogins(session: FederatedSessionMatch, transaction: Transaction | undefined): Promise<void> {
        await Promise.all(this.findLoginStrategies().map(async strategy => await strategy.endFederatedLogins(session, transaction)));
    }

    /**
     * The registered strategies that carry logins. A strategy that only reads a credential issued some
     * other way, such as an api key, has no login to end.
     * @returns Their instances.
     */
    private findLoginStrategies(): LoginAuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown>[] {
        return this.strategies.map(s => inject(s)).filter(isLoginAuthStrategy);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async logout<
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<LoginAuthStrategyInterface<Role, UserType, AuthDataType, RefreshLoginDataType, LogoutDataType>>,
        data: LogoutDataType
    ): Promise<LogoutResult> {
        let session: FederatedSession | undefined;
        try {
            session = await inject(strategy).logout(data);
            this.logger.audit({ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS });
        }
        catch (error) {
            // the endpoint still answers as if it worked - a client that cannot log out has nothing
            // useful to do with the failure, and telling it would only leave the session it was
            // trying to drop. The record is what makes it visible at all: a logout that revoked
            // nothing is a live credential somebody believes is dead.
            this.logger.audit({
                action: AuditAction.LOGOUT,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error)
            });
        }
        return { providerLogoutUrl: session == undefined ? undefined : await this.resolveProviderLogoutUrl(session) };
    }

    /**
     * The url that ends the session at the provider a login was started from, once the login ended here.
     *
     * A provider that cannot be reached to build it costs the user the logout there, not the one here,
     * which has happened already.
     * @param session - The session the login kept.
     * @returns The url, or undefined when the provider cannot be told.
     */
    private async resolveProviderLogoutUrl(session: FederatedSession): Promise<string | undefined> {
        const authenticator: Newable<FederatedAuthenticatorInterface<string, BaseUser<string>>> | undefined = FederatedRouteUtilities
            .findAuthenticators(this.authenticators)
            .find(a => inject(a).name === session.provider);
        if (authenticator == undefined) {
            return undefined;
        }
        try {
            return await inject(authenticator).createLogoutUrl(session);
        }
        catch (error) {
            this.logger.warn(`${authenticator.name} could not build the url that ends the session at the provider.`, { error });
            return undefined;
        }
    }
}