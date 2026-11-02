import { randomBytes } from 'node:crypto';

import { AuthServiceInterface } from './auth-service.interface';
import { ZibriApplication } from '../application/application';
import { type AuditServiceInterface } from '../audit/audit-service.interface';
import { register } from '../di/register.function';
import { TwoFactorMethod } from './2fa/methods/two-factor-method.interface';
import { ReauthenticationRequiredError } from './2fa/reauthentication-required.error';
import { SecondFactorRequiredError } from './2fa/second-factor-required.error';
import { TwoFactorAtLogin } from './2fa/two-factor-at-login.type';
import { TwoFactorMethods } from './2fa/two-factor-methods.model';
import { type TwoFactorServiceInterface } from './2fa/two-factor-service.interface';
import { AuthControllerUtilities } from './auth-controller/auth-controller.utilities';
import { AuthenticatorInterface } from './authenticators/authenticator.interface';
import { Authenticators } from './authenticators/authenticators.model';
import { FederatedAuthenticatorClass, FederatedRouteUtilities } from './authenticators/federated/federated-route.utilities';
import { FederatedSessionMatch } from './authenticators/federated/federated-session-match.model';
import { FederatedSession } from './authenticators/federated/federated-session.model';
import { FederatedSessionUtilities } from './authenticators/federated/federated-session.utilities';
import { IdentityLinkingAuthenticatorInterface, isIdentityLinkingAuthenticator } from './authenticators/identity-linking-authenticator.interface';
import { IdentityLinkingAuthenticators } from './authenticators/identity-linking-authenticators.model';
import { LinkIdentityConfirmingAuthenticatorInterface } from './authenticators/link-identity-confirming-authenticator.interface';
import { LinkedIdentity } from './authenticators/linked-identity.model';
import { ChangePasswordData } from './authenticators/password/change-password-data.model';
import { ConfirmPasswordResetData } from './authenticators/password/confirm-password-reset-data.model';
import { PasswordChangeRequiredError } from './authenticators/password/password-change-required.error';
import { PasswordAuthenticator } from './authenticators/password/password.authenticator';
import { RequestPasswordResetData } from './authenticators/password/request-password-reset-data.model';
import { isProviderAccessAuthenticator, ProviderAccessAuthenticatorInterface } from './authenticators/provider-access-authenticator.interface';
import { ProviderAccessFailure } from './authenticators/provider-access-failure.enum';
import { ProviderAccessError } from './authenticators/provider-access.error';
import { isRefreshResolvingAuthenticator } from './authenticators/refresh-resolving-authenticator.interface';
import { type CurrentUser } from './decorators/current-user.decorator';
import { type HashServiceInterface } from './hash/hash-service.interface';
import { Sha256HashStrategy } from './hash/strategies/sha256.hash-strategy';
import { Authentication } from './models/authentication.model';
import { BaseUser } from './models/base-user.model';
import { ClaimedUser } from './models/claimed-user.model';
import { EndedLogin } from './models/ended-login.model';
import { HasPermissionMetadata } from './models/has-permission-metadata.model';
import { IsLoggedInMetadata } from './models/is-logged-in-metadata.model';
import { IsNotLoggedInMetadata } from './models/is-not-logged-in-metadata.model';
import { ListedLogin } from './models/listed-login.model';
import { LoginTicketPurpose } from './models/login-ticket-purpose.enum';
import { LoginTicket, LoginTicketCreateData } from './models/login-ticket.model';
import { LogoutResult } from './models/logout-result.model';
import { ProviderAuthentication } from './models/provider-authentication.model';
import { Require2faMetadata } from './models/require-2fa-metadata.model';
import type { Require2faProviderFactors } from './models/require-2fa-provider-factors.model';
import type { Require2faReauth, Require2faReauthOptions } from './models/require-2fa-reauth.model';
import { ResolvedAuthMetadata, ResolvedRouteAuth } from './models/resolved-auth-metadata.model';
import { RouteAuthConfiguration } from './models/route-auth-configuration.model';
import { UserLogin } from './models/user-login.model';
import { type Permission } from './roles/permission.type';
import { type PlatformPermission } from './roles/platform-permission.type';
import { RoleLevel } from './roles/role-level.type';
import { type RoleServiceInterface } from './roles/role-service.interface';
import { type RouteAuthServiceInterface } from './route-auth-service.interface';
import { ApiKeyClientAuthentication } from './strategies/api-key/api-key-client-authentication.model';
import { ApiKeyCreateData } from './strategies/api-key/api-key-create-data.model';
import { type ApiKeyServiceInterface } from './strategies/api-key/api-key-service.interface';
import { ApiKey } from './strategies/api-key/api-key.model';
import { CreatedApiKey } from './strategies/api-key/created-api-key.model';
import { AuthStrategies } from './strategies/auth-strategies.model';
import { AuthStrategyInterface } from './strategies/auth-strategy.interface';
import { CredentialLimits } from './strategies/credential-limits.model';
import { isLoginAuthStrategy, LoginAuthStrategyInterface } from './strategies/login-auth-strategy.interface';
import { isLoginListingAuthStrategy, LoginListingAuthStrategyInterface } from './strategies/login-listing-auth-strategy.interface';
import { type UserServiceInterface } from './user/user-service.interface';
import { AlsUtilities } from '../context/als.utilities';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { IsolationLevel } from '../data-source/data-sources/data-source.interface';
import { Repository } from '../data-source/repository/repository';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { SpanningTransaction } from '../data-source/transaction/spanning-transaction.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { ErrorUtilities } from '../error-handling/error.utilities';
import { AccountDeactivatedError } from '../error-handling/errors/account-deactivated.error';
import { AccountLockedError } from '../error-handling/errors/account-locked.error';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { CsrfTokenRefusedError } from '../error-handling/errors/csrf-token-refused.error';
import { ForbiddenError } from '../error-handling/errors/forbidden.error';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../error-handling/errors/unauthorized.error';
import { InternalError } from '../error-handling/internal-error.model';
import { BeforeAppShutdown } from '../global/before-app-shutdown.interface';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppStart } from '../global/on-app-start.interface';
import { RouteRegistry } from '../global/route-registry/route.registry';
import { type LeaseServiceInterface } from '../leases/lease-service.interface';
import { $ts } from '../localization/translate.function';
import { AuditAction, AuditOutcome, AuditReason } from '../logging/audit-event.model';
import { AuditUtilities } from '../logging/audit.utilities';
import { type LoggerInterface } from '../logging/logger.interface';
import { BaseMembership } from '../tenancy/membership/base-membership.model';
import { type CurrentMembership } from '../tenancy/membership/current-membership.model';
import { type MembershipServiceInterface } from '../tenancy/membership/membership-service.interface';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * The login a request carries, of a strategy that lists its logins.
 */
type CurrentLogin = {
    /**
     * The strategy carrying it.
     */
    strategy: LoginListingAuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown>,
    /**
     * The id the strategy lists it by.
     */
    loginId: string
};

/**
 * A login as a strategy lists it, with the strategy.
 */
type StrategyLogin = {
    /**
     * The strategy carrying it.
     */
    strategy: LoginListingAuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown>,
    /**
     * The login.
     */
    login: ListedLogin
};

/**
 * Who a login waiting on a ticket is for, and how they proved it.
 */
type TicketedLogin = {
    /**
     * The user.
     */
    userId: string,
    /**
     * The account the credentials named, as the trail records it.
     */
    subject: string | undefined,
    /**
     * When the user proved who they are.
     */
    authenticatedAt: Date,
    /**
     * The session at a provider the login was started from, if any.
     */
    federatedSession: FederatedSession | undefined
};

const PERMISSIONS_TOKEN: string = 'ZIBRI_DI_TOKENS.PERMISSIONS';
const TWO_FACTOR_AT_LOGIN_VALUES: TwoFactorAtLogin[] = ['never', 'ifEnrolled', 'required'];

/**
 * Default auth service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class AuthService implements AuthServiceInterface, OnAppInit, OnAppStart, BeforeAppShutdown {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly strategies: AuthStrategies = [];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly authenticators: Authenticators = [];

    /**
     * The authenticators that log users in at a provider, by the name of the provider: every callback,
     * logout and metadata route looks its provider up here.
     */
    private federatedAuthenticators: Map<string, FederatedAuthenticatorClass> = new Map();

    /**
     * Whether a login asks for a second factor, as the application declared it. Without a fallback:
     * the option exists precisely because the framework does not get to pick one.
     */
    private twoFactorAtLogin!: TwoFactorAtLogin;

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

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by init, instead of failing on a repository token while this is built
    private get loginTicketRepository(): Repository<LoginTicket, LoginTicketCreateData> {
        return inject(repositoryTokenFor(LoginTicket));
    }

    private get hashService(): HashServiceInterface {
        return inject(ZIBRI_DI_TOKENS.HASH_SERVICE);
    }

    private get apiKeyService(): ApiKeyServiceInterface {
        return inject(ZIBRI_DI_TOKENS.API_KEY_SERVICE);
    }

    private get auditService(): AuditServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    private get roleService(): RoleServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
    }

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    private get routeAuthService(): RouteAuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE);
    }

    /**
     * Who the credential of each request claims to be, while the deployment trusts credentials,
     * keyed like principals and for the same reasons.
     */
    private readonly claims: WeakMap<
        HttpRequestContext | WebsocketRequestContext,
        Map<string, Promise<ClaimedUser<string> | undefined>>
    > = new WeakMap();

    /**
     * The membership each request acts through, for as long as it is being handled, keyed like
     * principals and for the same reasons.
     */
    private readonly memberships: WeakMap<
        HttpRequestContext | WebsocketRequestContext,
        Map<string, Promise<BaseMembership<string> | undefined>>
    > = new WeakMap();

    /**
     * What the credential of each request may do, for as long as it is being handled, keyed like
     * principals: every permission check asks, and a strategy may verify a token to answer.
     */
    private readonly credentialLimits: WeakMap<
        HttpRequestContext | WebsocketRequestContext,
        Map<string, Promise<CredentialLimits | undefined>>
    > = new WeakMap();

    /**
     * The undeclared roles and permissions a check from the application's code has already been
     * warned about, so a check on a hot path warns once rather than once per request. Bounded by the
     * names the code is written with.
     */
    private readonly reportedUndeclared: Set<string> = new Set();

    /**
     * The password resets still being made after their request was answered, which a shutdown waits
     * for.
     */
    private readonly pendingPasswordResets: Set<Promise<void>> = new Set();

    /**
     * The requests whose credential a strategy refused for a missing or wrong csrf token, keyed like
     * principals: read as no login, and refused with this where a login is needed.
     */
    private readonly csrfRefusals: WeakMap<HttpRequestContext | WebsocketRequestContext, CsrfTokenRefusedError> = new WeakMap();

    private get leaseService(): LeaseServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }

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
        private readonly defaultReauthWindowInMs: number,
        @Inject(ZIBRI_DI_TOKENS.REQUIRE_2FA_PROVIDER_FACTORS)
        private readonly defaultProviderFactors: Require2faProviderFactors,
        @Inject(ZIBRI_DI_TOKENS.LOGIN_TICKET_EXPIRES_IN_MS)
        private readonly loginTicketExpiresInMs: number
    ) {}

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
        this.federatedAuthenticators = FederatedRouteUtilities.resolveAuthenticatorsByName(this.authenticators);
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
        this.initTwoFactorAtLogin(app);
        const loginLimit: number | undefined = inject(ZIBRI_DI_TOKENS.MAX_LOGINS_PER_USER);
        if (loginLimit != undefined && (!Number.isInteger(loginLimit) || loginLimit < 1)) {
            throw new InternalError(`ZIBRI_DI_TOKENS.MAX_LOGINS_PER_USER must be a whole number of at least 1, got ${loginLimit}.`);
        }
    }

    /**
     * Reads whether a login asks for a second factor, and prepares what asking needs.
     * @param app - The application that starts.
     * @throws {InternalError} When the option is none of its values.
     */
    private initTwoFactorAtLogin(app: ZibriApplication): void {
        const { twoFactorAtLogin } = app.options;
        // checked at runtime as well: the type requires it, but an application built against an older
        // declaration passes nothing, and "nothing" must not read as a policy
        if (!TWO_FACTOR_AT_LOGIN_VALUES.includes(twoFactorAtLogin)) {
            throw new InternalError(`twoFactorAtLogin must be one of ${TWO_FACTOR_AT_LOGIN_VALUES.join(', ')}, got ${twoFactorAtLogin}.`);
        }
        this.twoFactorAtLogin = twoFactorAtLogin;
        if (twoFactorAtLogin !== 'never') {
            validateEntitiesRegistered(AuthService.name, app, LoginTicket);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppStart(app: ZibriApplication): void {
        // on start rather than on init, once every strategy, authenticator and two factor method has
        // been initialized
        AuthControllerUtilities.validateControllers(app);
        // on start rather than on init: a route registered directly on the router after the
        // application initialized is one a provider may be sent back to as well
        for (const authenticator of this.federatedAuthenticators.values()) {
            FederatedRouteUtilities.validateRouteUrls(authenticator);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findFederatedAuthenticator(provider: string): FederatedAuthenticatorClass | undefined {
        return this.federatedAuthenticators.get(provider);
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
        transaction: RepositoryTransaction | undefined
    ): Promise<AuthDataType> {
        // recorded here rather than in the authenticators and strategies, so that custom ones are
        // audited without having to remember to be.
        //
        // The only way into a login: there is deliberately nothing that starts one for a user without
        // credentials an authenticator checked. Logging in at a provider, a one-time code, a
        // registration that has just created the user - each is a credential with an authenticator
        const subject: string | undefined = AuditUtilities.resolveSubject(credentials);
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
            await this.validateSecondFactorAtLogin(authentication, subject);
            // after the second factor, which asks for it again once presented: a new password set with
            // the old one alone would lock the user out of an account somebody else holds the password of
            if (authentication.passwordChangeRequired === true) {
                await this.requirePasswordChangeAtLogin({
                    userId: authentication.user.id,
                    subject,
                    authenticatedAt: authentication.authenticatedAt,
                    federatedSession: authentication.federatedSession
                });
            }
            const authData: AuthDataType = await inject(strategy).startLogin(authentication, transaction);
            await this.endLoginsPastLimit(authentication.user.id, transaction);
            this.auditService.record({
                action: AuditAction.LOGIN,
                outcome: AuditOutcome.SUCCESS,
                subject,
                userId: authentication.user.id
            }, transaction);
            return authData;
        }
        catch (error) {
            // a login waiting for its second factor or a new password is recorded as such where it is
            // turned away, and is not a failed one
            if (!(error instanceof SecondFactorRequiredError) && !(error instanceof PasswordChangeRequiredError)) {
                this.auditService.record({
                    action: AuditAction.LOGIN,
                    outcome: AuditOutcome.FAILURE,
                    reason: AuditUtilities.resolveReason(error),
                    subject
                });
            }
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestSecondFactorAtLogin<
        TwoFactorRegistrationRequestData,
        TwoFactorRegistrationConfirmData,
        SecondFactorRequestType
    >(
        ticket: string,
        method: TwoFactorMethod<TwoFactorRegistrationRequestData, TwoFactorRegistrationConfirmData, unknown, SecondFactorRequestType>
    ): Promise<SecondFactorRequestType> {
        const found: LoginTicket = await this.resolveLoginTicket(ticket, LoginTicketPurpose.SECOND_FACTOR);
        const user: BaseUser<string> = await this.resolveTicketUser(found);
        return await this.twoFactorService.requestSecondFactor(user, method);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestTwoFactorRegistrationAtLogin<
        TwoFactorRegistrationRequestData,
        TwoFactorRegistrationConfirmData,
        TwoFactorRegistrationRequestResult
    >(
        ticket: string,
        method: TwoFactorMethod<
            TwoFactorRegistrationRequestData,
            TwoFactorRegistrationConfirmData,
            TwoFactorRegistrationRequestResult,
            unknown
        >,
        data: TwoFactorRegistrationRequestData
    ): Promise<TwoFactorRegistrationRequestResult> {
        const user: BaseUser<string> = await this.resolveEnrollingUser(ticket);
        return await this.twoFactorService.requestTwoFactorRegistration(user, method, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmTwoFactorRegistrationAtLogin<
        TwoFactorRegistrationRequestData,
        TwoFactorRegistrationConfirmData
    >(
        ticket: string,
        method: TwoFactorMethod<TwoFactorRegistrationRequestData, TwoFactorRegistrationConfirmData, unknown, unknown>,
        data: TwoFactorRegistrationConfirmData
    ): Promise<void> {
        const user: BaseUser<string> = await this.resolveEnrollingUser(ticket);
        await this.twoFactorService.confirmTwoFactorRegistration(user, method, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmSecondFactorAtLogin<
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        ticket: string,
        strategy: Newable<LoginAuthStrategyInterface<Role, UserType, AuthDataType, RefreshLoginDataType, LogoutDataType>>,
        transaction: RepositoryTransaction | undefined
    ): Promise<AuthDataType> {
        let subject: string | undefined = undefined;
        let userId: string | undefined = undefined;
        try {
            const found: LoginTicket = await this.resolveLoginTicket(ticket, LoginTicketPurpose.SECOND_FACTOR);
            subject = found.subject ?? undefined;
            userId = found.userId;
            const user: UserType = await this.resolveTicketUser<Role, UserType>(found);
            const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
            if (context == undefined) {
                throw new InternalError('A login is completed inside the request that presents its second factor.');
            }
            const methods: TwoFactorMethods = await this.twoFactorService.findRegisteredMethods(user);
            if (!methods.length) {
                throw new ForbiddenError($ts`Enroll a second factor to finish logging in.`);
            }
            // the user's own methods only, so that a wrong code is answered as one rather than as one
            // of several factors the user never held
            await this.twoFactorService.validate2fa(user, context, methods);
            if (found.passwordChangeRequired) {
                // spent outside the transaction, which the refusal below rolls back: the factor was
                // presented, and the ticket for the new password is what the login continues with
                await this.loginTicketRepository.updateById(found.id, { spent: true });
                await this.requirePasswordChangeAtLogin({
                    userId: found.userId,
                    subject,
                    authenticatedAt: found.authenticatedAt,
                    federatedSession: FederatedSessionUtilities.fromColumns(found)
                });
            }
            // inside the transaction, so that a strategy that cannot start the login leaves the
            // ticket for another try. The factor itself is spent either way
            await this.loginTicketRepository.updateById(found.id, { spent: true }, { transaction });
            const authData: AuthDataType = await inject(strategy).startLogin(
                { user, authenticatedAt: found.authenticatedAt, federatedSession: FederatedSessionUtilities.fromColumns(found) },
                transaction
            );
            await this.endLoginsPastLimit(user.id, transaction);
            this.auditService.record({ action: AuditAction.LOGIN, outcome: AuditOutcome.SUCCESS, subject, userId }, transaction);
            return authData;
        }
        catch (error) {
            // waiting for a new password is recorded where the login is turned away for it
            if (!(error instanceof PasswordChangeRequiredError)) {
                this.auditService.record({
                    action: AuditAction.LOGIN,
                    outcome: AuditOutcome.FAILURE,
                    reason: AuditUtilities.resolveReason(error),
                    subject,
                    userId
                });
            }
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async changePasswordAtLogin<
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        ticket: string,
        newPassword: string,
        strategy: Newable<LoginAuthStrategyInterface<Role, UserType, AuthDataType, RefreshLoginDataType, LogoutDataType>>,
        transaction: RepositoryTransaction | undefined
    ): Promise<AuthDataType> {
        let subject: string | undefined = undefined;
        let userId: string | undefined = undefined;
        try {
            const found: LoginTicket = await this.resolveLoginTicket(ticket, LoginTicketPurpose.PASSWORD_CHANGE);
            subject = found.subject ?? undefined;
            userId = found.userId;
            const user: UserType = await this.resolveTicketUser<Role, UserType>(found);
            // inside the transaction, so that a password the policy refuses leaves the ticket for another
            await inject(PasswordAuthenticator).changePasswordAtLogin(user, newPassword, transaction);
            await this.loginTicketRepository.updateById(found.id, { spent: true }, { transaction });
            // every login of the user, as a reset ends them: whoever else knew the old password may hold one
            await this.endLogins(user.id, transaction);
            this.auditService.record({ action: AuditAction.PASSWORD_CHANGED, outcome: AuditOutcome.SUCCESS, userId }, transaction);
            const authData: AuthDataType = await inject(strategy).startLogin(
                { user, authenticatedAt: found.authenticatedAt, federatedSession: FederatedSessionUtilities.fromColumns(found) },
                transaction
            );
            await this.endLoginsPastLimit(user.id, transaction);
            this.auditService.record({ action: AuditAction.LOGIN, outcome: AuditOutcome.SUCCESS, subject, userId }, transaction);
            return authData;
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.LOGIN,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                subject,
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requirePasswordChange(userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        await inject(PasswordAuthenticator).requirePasswordChange(userId, transaction);
        // whoever the change is meant to lock out may hold a login of any strategy
        await this.endLogins(userId, transaction);
        this.auditService.record({ action: AuditAction.PASSWORD_CHANGE_REQUIRED, outcome: AuditOutcome.SUCCESS, userId }, transaction);
    }

    /**
     * Turns a login into one waiting for a new password.
     * @param login - Who the login is for, and how they proved it.
     * @throws {PasswordChangeRequiredError} With the ticket the new password is set with.
     */
    private async requirePasswordChangeAtLogin(login: TicketedLogin): Promise<never> {
        const ticket: string = await this.issueLoginTicket(login, LoginTicketPurpose.PASSWORD_CHANGE, false);
        this.auditService.record({
            action: AuditAction.LOGIN_PENDING,
            outcome: AuditOutcome.SUCCESS,
            subject: login.subject,
            userId: login.userId
        });
        throw new PasswordChangeRequiredError(ticket);
    }

    /**
     * Stores a ticket a login continues with.
     *
     * Outside the request's transaction: the login answers with a refusal, which rolls that transaction
     * back, and the ticket has to outlive it.
     * @param login - Who the login is for, and how they proved it.
     * @param purpose - What the ticket continues the login with.
     * @param passwordChangeRequired - Whether the user chooses a new password once the second factor was
     * presented.
     * @returns The ticket, as the login answers with it.
     */
    private async issueLoginTicket(
        login: TicketedLogin,
        purpose: LoginTicketPurpose,
        passwordChangeRequired: boolean
    ): Promise<string> {
        const ticket: string = randomBytes(32).toString('base64url');
        await this.loginTicketRepository.create({
            value: ticket,
            userId: login.userId,
            subject: login.subject,
            authenticatedAt: login.authenticatedAt,
            ...FederatedSessionUtilities.toColumns(login.federatedSession),
            purpose,
            passwordChangeRequired,
            spent: false,
            expirationDate: new Date(Date.now() + this.loginTicketExpiresInMs)
        });
        return ticket;
    }

    /**
     * Turns a login into one waiting for its second factor, when the application asks for one at
     * login and the user is to present or enroll one.
     * @param authentication - Who proved who they are.
     * @param subject - The account the credentials named, for the trail.
     * @throws {SecondFactorRequiredError} With the ticket the login continues with.
     */
    private async validateSecondFactorAtLogin(
        authentication: Authentication<BaseUser<string>>,
        subject: string | undefined
    ): Promise<void> {
        if (this.twoFactorAtLogin === 'never') {
            return;
        }
        const methods: TwoFactorMethods = await this.twoFactorService.findRegisteredMethods(authentication.user);
        if (this.twoFactorAtLogin === 'ifEnrolled' && !methods.length) {
            return;
        }
        const ticket: string = await this.issueLoginTicket(
            {
                userId: authentication.user.id,
                subject,
                authenticatedAt: authentication.authenticatedAt,
                federatedSession: authentication.federatedSession
            },
            LoginTicketPurpose.SECOND_FACTOR,
            authentication.passwordChangeRequired === true
        );
        this.auditService.record({
            action: AuditAction.LOGIN_PENDING,
            outcome: AuditOutcome.SUCCESS,
            subject,
            userId: authentication.user.id
        });
        throw new SecondFactorRequiredError(ticket, methods.map(m => inject(m).name));
    }

    /**
     * Finds the ticket a login continues with.
     * @param ticket - The ticket as the login answered it.
     * @param purpose - What the login continues with, which the ticket has to be for.
     * @returns The ticket.
     * @throws {UnauthorizedError} When there is no such ticket for the purpose, or it is spent or expired.
     */
    private async resolveLoginTicket(ticket: string, purpose: LoginTicketPurpose): Promise<LoginTicket> {
        const found: LoginTicket | undefined = await this.loginTicketRepository.findOne({
            where: { value: await this.hashService.hash(ticket, { strategy: Sha256HashStrategy }) },
            required: false
        });
        // a ticket of the other purpose answers like an unknown one: one for a new password would log
        // in past it on the route of the second factor, and one for the second factor would set a
        // password with nothing but the old one
        if (found?.purpose !== purpose || found.spent || new Date(found.expirationDate).getTime() <= Date.now()) {
            throw new UnauthorizedError($ts`This login ticket is unknown, spent or expired. Log in again.`);
        }
        return found;
    }

    /**
     * The user a login ticket is for, as far as they may still log in.
     * @param ticket - The ticket.
     * @returns The user.
     * @throws {UnauthorizedError} When the user is gone.
     * @throws {AccountDeactivatedError} When the user was deactivated since.
     * @throws {AccountLockedError} When the user's account was locked since.
     */
    private async resolveTicketUser<Role extends string, UserType extends BaseUser<Role>>(ticket: LoginTicket): Promise<UserType> {
        const user: UserType | undefined = await this.userService.findById<Role, UserType, false>(ticket.userId, { required: false });
        if (user == undefined) {
            throw new UnauthorizedError($ts`This login ticket is unknown, spent or expired. Log in again.`);
        }
        // again, as a login checks them: both can have changed since the credentials were accepted
        if (user.deactivatedAt != undefined) {
            throw new AccountDeactivatedError();
        }
        if (await this.twoFactorService.resolveLock(user) === 'account') {
            throw new AccountLockedError();
        }
        return user;
    }

    /**
     * The user a login ticket is for, when they enroll their first second factor with it.
     * @param ticket - The ticket as the login answered it.
     * @returns The user.
     * @throws {ForbiddenError} When the user has a second factor already.
     */
    private async resolveEnrollingUser(ticket: string): Promise<BaseUser<string>> {
        const found: LoginTicket = await this.resolveLoginTicket(ticket, LoginTicketPurpose.SECOND_FACTOR);
        const user: BaseUser<string> = await this.resolveTicketUser(found);
        // the credentials alone must not be enough to add a factor of the caller's own to an account
        // that has one, exactly as on the enrollment routes of a logged in user
        if (await this.twoFactorService.isRegistered(user)) {
            throw new ForbiddenError($ts`This account has a second factor. Present it to log in.`);
        }
        return user;
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
            this.auditService.record({
                action: AuditAction.REFRESH_LOGIN,
                outcome: AuditOutcome.SUCCESS,
                userId: AuditUtilities.resolveUserId(authData)
            });
            return authData;
        }
        catch (error) {
            // a refused refresh is only an expired or unknown credential here. The one that matters -
            // a credential presented after it was already exchanged - is recorded by the strategy
            // that detects it, because only it can tell reuse from expiry.
            this.auditService.record({
                action: AuditAction.REFRESH_LOGIN,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error)
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
        LinkIdentityRequestType,
        LinkIdentityStartType
    >(
        authenticator: Newable<IdentityLinkingAuthenticatorInterface<
            Role, UserType, CredentialsType, TicketType, RegistrationType, IdentityType, LinkIdentityRequestType, LinkIdentityStartType
        >>,
        ticket: TicketType,
        transaction: RepositoryTransaction | undefined
    ): Promise<RegistrationType> {
        return await inject(authenticator).resolveRegistration(ticket, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async linkTicketIdentity<
        Role extends string,
        UserType extends BaseUser<Role>,
        CredentialsType,
        TicketType,
        RegistrationType,
        IdentityType extends Pick<BaseEntity, 'id'>,
        LinkIdentityRequestType,
        LinkIdentityStartType
    >(
        authenticator: Newable<IdentityLinkingAuthenticatorInterface<
            Role, UserType, CredentialsType, TicketType, RegistrationType, IdentityType, LinkIdentityRequestType, LinkIdentityStartType
        >>,
        ticket: TicketType,
        userId: string,
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        try {
            await inject(authenticator).linkTicketIdentity(ticket, userId, transaction);
            this.auditService.record({ action: AuditAction.IDENTITY_LINKED, outcome: AuditOutcome.SUCCESS, userId }, transaction);
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.IDENTITY_LINKED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestLinkIdentity<
        Role extends string,
        UserType extends BaseUser<Role>,
        CredentialsType,
        TicketType,
        RegistrationType,
        IdentityType extends Pick<BaseEntity, 'id'>,
        LinkIdentityRequestType,
        LinkIdentityStartType
    >(
        authenticator: Newable<IdentityLinkingAuthenticatorInterface<
            Role, UserType, CredentialsType, TicketType, RegistrationType, IdentityType, LinkIdentityRequestType, LinkIdentityStartType
        >>,
        request: LinkIdentityRequestType
    ): Promise<LinkIdentityStartType> {
        // read from the request rather than taken as a parameter, so an identity is only ever linked
        // to the user who asked for it. Nothing is recorded yet: the identity is linked, or refused,
        // once the user has logged in with it
        const context: HttpRequestContext | WebsocketRequestContext | undefined
            = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (context == undefined) {
            throw new UnauthorizedError($ts`Could not resolve the currently logged in user.`);
        }
        const user: CurrentUser<UserType> = await this.resolveCurrentUser<Role, UserType, true>(context, this.strategies, true);
        return await inject(authenticator).requestLinkIdentity(user.id, request);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmLinkIdentity<Role extends string, UserType extends BaseUser<Role>, CredentialsType, LinkIdentityAnswerType>(
        authenticator: Newable<LinkIdentityConfirmingAuthenticatorInterface<Role, UserType, CredentialsType, LinkIdentityAnswerType>>,
        answer: LinkIdentityAnswerType
    ): Promise<void> {
        // the user of the request, for the reason requestLinkIdentity reads it from there
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (context == undefined) {
            throw new UnauthorizedError($ts`Could not resolve the currently logged in user.`);
        }
        const user: CurrentUser<UserType> = await this.resolveCurrentUser<Role, UserType, true>(context, this.strategies, true);
        try {
            await inject(authenticator).confirmLinkIdentity(user.id, answer);
            this.auditService.record({ action: AuditAction.IDENTITY_LINKED, outcome: AuditOutcome.SUCCESS, userId: user.id });
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.IDENTITY_LINKED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId: user.id
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIdentities(userId: string, transaction: RepositoryTransaction | undefined): Promise<LinkedIdentity[]>;
    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIdentities<IdentityType extends Pick<BaseEntity, 'id'>>(
        userId: string,
        transaction: RepositoryTransaction | undefined,
        authenticators: IdentityLinkingAuthenticators<IdentityType>
    ): Promise<LinkedIdentity<IdentityType>[]>;
    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIdentities(
        userId: string,
        transaction: RepositoryTransaction | undefined,
        authenticators: IdentityLinkingAuthenticators = this.findIdentityLinkingAuthenticators()
    ): Promise<LinkedIdentity[]> {
        const found: LinkedIdentity[][] = await Promise.all(authenticators.map(async authenticator => {
            const instance: InstanceType<IdentityLinkingAuthenticators[number]> = inject(authenticator);
            return (await instance.findIdentities(userId, transaction)).map(identity => ({ authenticator: instance.name, identity }));
        }));
        return found.flat();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unlinkIdentity(userId: string, identityId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        try {
            const holder: InstanceType<IdentityLinkingAuthenticators[number]>
                = await this.resolveIdentityHolder(userId, identityId, transaction);
            await holder.unlinkIdentity(userId, identityId, transaction);
            this.auditService.record({ action: AuditAction.IDENTITY_UNLINKED, outcome: AuditOutcome.SUCCESS, userId }, transaction);
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.IDENTITY_UNLINKED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUserRows(userIds: string[], transaction: RepositoryTransaction): Promise<void> {
        if (!userIds.length) {
            return;
        }
        // one after the other rather than together: they share the one transaction, which runs one
        // statement at a time. Each deletes its rows of all the users at once
        for (const authenticator of this.authenticators) {
            await inject(authenticator).deleteUserRows?.(userIds, transaction);
        }
        for (const strategy of this.strategies) {
            await inject(strategy).deleteUserRows?.(userIds, transaction);
        }
        await this.twoFactorService.deleteUserRows(userIds, transaction);
        await this.apiKeyService.deleteUserRows(userIds, transaction);
        await inject(ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_SERVICE).deleteUserRows(userIds, transaction);
        // only an application whose logins ask for a second factor declares the tickets
        if (this.twoFactorAtLogin !== 'never') {
            await this.loginTicketRepository.deleteAll({ userId: { oneOf: userIds } }, { transaction });
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
    async revokeProviderAccess(userId: string, identityId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        try {
            const holder: ProviderAccessAuthenticatorInterface = await this.resolveProviderAccessHolder(userId, identityId, transaction);
            // the success is recorded by the authenticator, which records every end of an access the
            // same way, also one the provider refused
            await holder.revokeAccess(userId, identityId, transaction);
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.PROVIDER_ACCESS_REVOKED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revokeProviderLogin(userId: string, identityId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        try {
            const holder: ProviderAccessAuthenticatorInterface = await this.resolveProviderAccessHolder(userId, identityId, transaction);
            // the success is recorded by the authenticator, which knows whether the identity stopped
            // logging in or was unlinked
            await holder.revokeLogin(userId, identityId, transaction);
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.IDENTITY_LOGIN_REVOKED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createApiKey(
        userId: string,
        data: ApiKeyCreateData<undefined>,
        transaction: RepositoryTransaction | undefined
    ): Promise<CreatedApiKey>;
    // eslint-disable-next-line jsdoc/require-jsdoc
    async createApiKey(
        userId: string,
        data: ApiKeyCreateData<ApiKeyClientAuthentication>,
        transaction: RepositoryTransaction | undefined
    ): Promise<ApiKey>;
    // eslint-disable-next-line jsdoc/require-jsdoc
    async createApiKey(
        userId: string,
        data: ApiKeyCreateData,
        transaction: RepositoryTransaction | undefined
    ): Promise<CreatedApiKey | ApiKey> {
        try {
            const clientAuthentication: ApiKeyClientAuthentication | undefined = data.clientAuthentication;
            const created: CreatedApiKey | ApiKey = clientAuthentication == undefined
                ? await this.apiKeyService.create(userId, { ...data, clientAuthentication }, transaction)
                : await this.apiKeyService.createClient(userId, { ...data, clientAuthentication }, transaction);
            // a key is a way into the account for as long as it lives, including for whoever made it
            // after getting in some other way, which is why its creation is worth a line of its own
            this.auditService.record({ action: AuditAction.API_KEY_CREATED, outcome: AuditOutcome.SUCCESS, userId }, transaction);
            return created;
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.API_KEY_CREATED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findApiKeys(userId: string, transaction: RepositoryTransaction | undefined): Promise<ApiKey[]> {
        return await this.apiKeyService.findForUser(userId, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revokeApiKey(userId: string, apiKeyId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        await this.auditApiKeyRevocation(userId, transaction, async () => await this.apiKeyService.revoke(userId, apiKeyId, transaction));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revokeApiKeys(userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        await this.auditApiKeyRevocation(userId, transaction, async () => await this.apiKeyService.revokeForUser(userId, transaction));
    }

    /**
     * Revokes api keys of a user, and records it.
     * @param userId - The id of the user.
     * @param transaction - The transaction they are revoked in, if any.
     * @param revoke - Revokes them.
     */
    private async auditApiKeyRevocation(
        userId: string,
        transaction: RepositoryTransaction | undefined,
        revoke: () => Promise<void>
    ): Promise<void> {
        try {
            await revoke();
            this.auditService.record({ action: AuditAction.API_KEY_REVOKED, outcome: AuditOutcome.SUCCESS, userId }, transaction);
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.API_KEY_REVOKED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deactivateUser(userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        await this.auditUserChange(AuditAction.USER_DEACTIVATED, userId, transaction, async () => {
            await this.userService.updateDeactivatedAt(userId, new Date(), transaction);
            await this.endLogins(userId, transaction);
            // gone for good rather than paused: a key handed to a script outlives the reason the user
            // was deactivated, and reactivating them should not quietly bring it back
            await this.apiKeyService.revokeForUser(userId, transaction);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endAccess(userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        await this.auditUserChange(AuditAction.ACCESS_ENDED, userId, transaction, async () => {
            await this.endLogins(userId, transaction);
            await this.apiKeyService.revokeForUser(userId, transaction);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRefreshUser<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        transaction: RepositoryTransaction | undefined
    ): Promise<UserType> {
        let res: BaseUser<string> = user;
        // one after the other, since each is handed what the one before answered
        for (const authenticator of this.authenticators.map(a => inject(a)).filter(isRefreshResolvingAuthenticator)) {
            try {
                res = await authenticator.resolveRefreshUser(res, transaction);
            }
            catch (error) {
                if (error instanceof AccountDeactivatedError) {
                    // once the transaction is finished: the refusal rolls it back, and would take the
                    // ending with it
                    const end: () => Promise<void> = async () => await this.endAccess(user.id, undefined);
                    if (transaction == undefined) {
                        await end();
                    }
                    else {
                        transaction.afterFinish(end);
                    }
                }
                throw error;
            }
        }
        // the caller names the type of its users, as with resolveCurrentUser
        return res as UserType;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async reactivateUser(userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        await this.auditUserChange(AuditAction.USER_REACTIVATED, userId, transaction, async () => {
            // null rather than undefined: it clears the column
            // eslint-disable-next-line unicorn/no-null
            await this.userService.updateDeactivatedAt(userId, null, transaction);
        });
    }

    /**
     * Changes a user, and records it.
     * @param action - What is recorded.
     * @param userId - The id of the user.
     * @param transaction - The transaction they are changed in, if any.
     * @param change - Changes them.
     */
    private async auditUserChange(
        action: AuditAction,
        userId: string,
        transaction: RepositoryTransaction | undefined,
        change: () => Promise<void>
    ): Promise<void> {
        try {
            await change();
            this.auditService.record({ action, outcome: AuditOutcome.SUCCESS, userId }, transaction);
        }
        catch (error) {
            this.auditService.record({ action, outcome: AuditOutcome.FAILURE, reason: AuditUtilities.resolveReason(error), userId });
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
    async resolveCurrentUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        B extends boolean = true
    >(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        required: B
    ): Promise<B extends false ? CurrentUser<UserType> | undefined : CurrentUser<UserType>> {
        // deliberately not short circuited on the CURRENT_USER token. That token is resolved for
        // whatever the route asked for, and answering a call that named different strategies with it
        // hands back a user the caller said it would not accept - and skips the `required` check
        // below, so a route declaring it needs a user could be handed undefined instead of a 401.
        // The memo underneath keys on what the answer depends on, which is the same saving without
        // the confusion.
        const account: BaseUser<string> | undefined = await this.resolveCurrentAccount(context, allowedStrategies);
        if (account === undefined) {
            if (required) {
                throw new UnauthorizedError($ts`Could not resolve the currently logged in user.`);
            }
            return undefined as B extends false ? CurrentUser<UserType> | undefined : CurrentUser<UserType>;
        }
        // the membership every check of a logged in request in a tenant resolves already, so the
        // permissions in it cost nothing beyond what the request paid. Without the roles: code that
        // wants to know what the caller may do reads the permissions, which a role made at runtime and
        // a credential narrower than its user are described by as well
        const [membership, limits] = await Promise.all([
            this.resolveMembership(context, allowedStrategies),
            this.resolveCredentialLimits(context, allowedStrategies)
        ]);
        const { roles, ...rest } = account;
        const permissions: Permission[] = membership == undefined
            ? []
            : await this.roleService.resolvePermissionsOf(membership.roles, membership.tenantId);
        const currentUser: CurrentUser = {
            ...rest,
            permissions: this.narrowToCredential(permissions, limits),
            platformPermissions: this.narrowToCredential(this.roleService.resolvePlatformPermissionsOf(roles), limits)
        };
        // the caller names the type of its users: the row is theirs, read through their repository
        return currentUser as B extends false ? CurrentUser<UserType> | undefined : CurrentUser<UserType>;
    }

    /**
     * Resolves the account a request is from, once per request: the same resolution the checks run,
     * so a route that already established who this is does not read the account again. Always the
     * authoritative one: whoever asks for the current user wants the row, not what a credential claims
     * about it.
     * @param context - The request to resolve for.
     * @param allowedStrategies - The strategies that may answer.
     * @returns The account, its roles narrowed to what the credential may use, or undefined when no
     * strategy recognizes the request.
     */
    private async resolveCurrentAccount(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseUser<string> | undefined> {
        return await this.memoized(
            context,
            `resolved:${allowedStrategies.map(s => s.name).join(',')}`,
            async () => await this.readResolvedUser(context, allowedStrategies)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestPasswordReset<Role extends string, UserType extends BaseUser<Role>>(
        data: RequestPasswordResetData<Role, UserType>
    ): Promise<void> {
        // deliberately not audited here. A reset is only requested *through* this method when the
        // address turned out to belong to somebody, so an event recorded here would be missing
        // exactly the requests worth watching - the ones probing addresses that do not exist.
        // requestPasswordResetForEmail records the request instead, where every request is visible.
        await inject(PasswordAuthenticator).requestPasswordReset(data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestPasswordResetForEmail(email: string): Promise<void> {
        const user: BaseUser<string> | undefined = await this.userService.findByEmail(email, { required: false });
        // answered here, after the one lookup an unknown address costs as well. Making the link is a
        // read, a write, a template render and a queued mail, and waiting for them made a registered
        // address answer measurably slower: a list of who holds an account, for anyone timing it
        void this.trackPasswordReset(this.requestPasswordResetInBackground(email, user));
    }

    /**
     * Keeps a password reset among the pending ones, which a shutdown waits for, until it settles.
     * @param reset - The reset.
     */
    private async trackPasswordReset(reset: Promise<void>): Promise<void> {
        this.pendingPasswordResets.add(reset);
        try {
            await reset;
        }
        finally {
            this.pendingPasswordResets.delete(reset);
        }
    }

    /**
     * Makes the link of a password reset and mails it, then records the request. Never rejects: a
     * failure is recorded and logged, since nobody is waiting for it.
     * @param email - The address that was asked for.
     * @param user - Who holds it, if anybody.
     */
    private async requestPasswordResetInBackground(email: string, user: BaseUser<string> | undefined): Promise<void> {
        try {
            if (user) {
                await this.leaseService.withLease(
                    {
                        // one reset per user at a time, on every instance. The request is answered
                        // before the link exists, so two requests in a row both found no link yet and
                        // mailed two. Skipped, because the one holding it makes the link this would
                        key: `password-reset:${user.id}`,
                        leaseInMs: Ms.MINUTE,
                        mode: 'skip'
                    },
                    async () => await this.requestPasswordResetInTransaction(user)
                );
            }
            // after the commit, so the outcome describes what happened rather than what was about to
            // be attempted. A request for an address nobody holds is the one worth seeing: the answer
            // is identical either way, so a run against a list of addresses leaves no other trace.
            this.auditService.record({
                action: AuditAction.PASSWORD_RESET_REQUESTED,
                outcome: user ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
                reason: user ? undefined : AuditReason.NO_SUCH_SUBJECT,
                subject: email,
                userId: user?.id
            });
        }
        catch (error) {
            const reason: AuditReason = AuditUtilities.resolveReason(error);
            this.auditService.record({
                action: AuditAction.PASSWORD_RESET_REQUESTED,
                outcome: AuditOutcome.FAILURE,
                reason,
                subject: email,
                userId: user?.id
            });
            // a refusal, such as of an address that is not verified, is the trail's alone
            if (reason === AuditReason.ERROR) {
                this.logger.error(new InternalError('Could not make the requested password reset link', { cause: error }));
            }
        }
    }

    /**
     * Makes the link of a password reset and mails it, in a transaction of its own.
     * @param user - Who the link is for.
     */
    private async requestPasswordResetInTransaction(user: BaseUser<string>): Promise<void> {
        // spanning, as everywhere auth hands a transaction to an authenticator: one of the application
        // writes wherever it keeps its rows, and one reaching a single data source costs nothing extra
        const transaction: SpanningTransaction = new SpanningTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
        try {
            await this.requestPasswordReset({ user, transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async beforeAppShutdown(): Promise<void> {
        // before the other hooks, which the reset still needs: the audit trail flushes and the mail
        // transport closes in theirs. The server has stopped taking requests by now, so nothing adds
        // to these while they are waited for.
        await Promise.all(this.pendingPasswordResets);
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
            this.auditService.record({
                action: AuditAction.PASSWORD_RESET_CONFIRMED,
                outcome: AuditOutcome.SUCCESS,
                userId
            }, data.transaction);
        }
        catch (error) {
            // no subject: the request carries a reset token and a new password, and nothing that
            // names an account. Guessing tokens is what this event is for.
            this.auditService.record({
                action: AuditAction.PASSWORD_RESET_CONFIRMED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error)
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
    async checkRouteAccess(
        auth: RouteAuthConfiguration | undefined,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        const { metadata, requiresLogin }: ResolvedRouteAuth = this.routeAuthService.resolveManualRouteAuth(auth);
        await this.runChecks(metadata, requiresLogin, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validatePermissions(permissions: string[]): void {
        const undeclared: string | undefined = permissions
            .find(permission => !this.roleService.isPermission(permission) && !this.roleService.isPlatformPermission(permission));
        if (undeclared != undefined) {
            throw new BadRequestError($ts`The permission '${undeclared}' is not declared.`);
        }
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
        transaction: RepositoryTransaction | undefined
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
        transaction: RepositoryTransaction | undefined
    ): Promise<ProviderAccessAuthenticatorInterface> {
        const holder: InstanceType<IdentityLinkingAuthenticators[number]>
            = await this.resolveIdentityHolder(userId, identityId, transaction);
        if (!isProviderAccessAuthenticator(holder)) {
            throw new ProviderAccessError(ProviderAccessFailure.NOT_CONNECTED);
        }
        return holder;
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
        const require2faMetadata: Require2faMetadata | undefined = metadata.require2fa;
        // every check is answered here from the user a strategy resolved, never by the strategy
        // itself, so no two strategies can disagree about what a login or a permission means

        // isLoggedIn
        if (
            requiresLogin
            && !await this.isLoggedIn(context, isLoggedInMetadata?.allowedStrategies ?? this.strategies)
        ) {
            const csrfRefusal: CsrfTokenRefusedError | undefined = this.csrfRefusals.get(context);
            await this.auditDenied(
                context,
                isLoggedInMetadata?.allowedStrategies ?? this.strategies,
                csrfRefusal == undefined ? AuditReason.NOT_LOGGED_IN : AuditReason.CSRF
            );
            throw csrfRefusal ?? new UnauthorizedError($ts`You need to be logged in to access this route.`);
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

        await this.validateRoutePermissions(metadata, context);

        // require2fa - checked on every request to the route, never remembered on the session: one
        // code at login must not authorize every sensitive operation after it. A missing factor is a
        // 401, the reading RFC 9470 gives step-up: the caller still has a credential to present
        if (require2faMetadata) {
            const user: BaseUser<string> | undefined = await this.resolveCurrentAccount(context, this.strategies);
            if (user == undefined) {
                throw new UnauthorizedError($ts`Could not resolve the currently logged in user.`);
            }
            try {
                await this.validate2faOrReauth(user, context, require2faMetadata);
            }
            catch (error) {
                // the refusal is passed on as it is rather than replaced by one message, so the caller
                // learns whether to type a code, wait for the next one or wait before trying again
                if (ErrorUtilities.isRefusal(error)) {
                    this.auditService.record({
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
     * Runs the permission checks a route declared.
     * @param metadata - What the route resolved to.
     * @param context - The request being checked.
     * @throws When the caller lacks a permission the route requires.
     */
    private async validateRoutePermissions(
        metadata: ResolvedAuthMetadata,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        const hasPermissionMetadata: HasPermissionMetadata<Permission> | undefined = metadata.hasPermission;
        const hasPlatformPermissionMetadata: HasPermissionMetadata<PlatformPermission> | undefined = metadata.hasPlatformPermission;

        // hasPermission
        if (
            hasPermissionMetadata
            && !await this.hasPermission(
                context,
                hasPermissionMetadata.allowedStrategies ?? this.strategies,
                hasPermissionMetadata.permission
            )
        ) {
            await this.auditDenied(context, hasPermissionMetadata.allowedStrategies ?? this.strategies, AuditReason.MISSING_PERMISSION);
            // which permission opens a route is the authorization model, and the caller who just
            // proved they lack it is the last one it should be described to - walking the routes with
            // any account at all would otherwise map which permission guards which endpoint. The
            // audit event above keeps the distinction, named and attributed, where it is useful
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }

        // hasPlatformPermission
        if (
            hasPlatformPermissionMetadata
            && !await this.hasPlatformPermission(
                context,
                hasPlatformPermissionMetadata.allowedStrategies ?? this.strategies,
                hasPlatformPermissionMetadata.permission
            )
        ) {
            await this.auditDenied(
                context,
                hasPlatformPermissionMetadata.allowedStrategies ?? this.strategies,
                AuditReason.MISSING_PERMISSION
            );
            // worded like the refusal above, for the reason given there
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }
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
        // it holds exactly such a login, and the lock would otherwise be a way around itself. Nor does
        // the factor the login presented at its provider
        if (await this.twoFactorService.resolveLock(user) != undefined) {
            await this.twoFactorService.validate2fa(user, context, metadata.allowedMethods);
            return;
        }
        if (await this.hasProviderFactor(context, metadata.providerFactors ?? this.defaultProviderFactors)) {
            return;
        }
        if (reauth == undefined) {
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
     * Whether the caller presented a second factor the route counts at the provider their login went
     * through.
     * @param context - The request being checked.
     * @param factors - Which factors the route counts.
     * @returns False as well when the strategy cannot say how its caller logged in at the provider.
     */
    private async hasProviderFactor(
        context: HttpRequestContext | WebsocketRequestContext,
        factors: Require2faProviderFactors
    ): Promise<boolean> {
        if (factors === false) {
            return false;
        }
        const presented: ProviderAuthentication | undefined = await this.strategyFor(context, this.strategies)
            ?.resolveProviderAuthentication?.(context);
        return presented != undefined
            && (presented.methods.some(method => factors.methods?.includes(method) === true)
                || (presented.contextClass != undefined && factors.contextClasses?.includes(presented.contextClass) === true));
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
        const principal: ClaimedUser<string> | undefined = await this.resolvePrincipal(context, allowedStrategies);
        this.auditService.record({
            action: AuditAction.AUTHORIZATION,
            outcome: AuditOutcome.FAILURE,
            reason,
            userId: principal?.id
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveIsCallerIdentified(context: HttpRequestContext | WebsocketRequestContext): Promise<boolean> {
        // every way of finding out who asked goes through the memo, so what it holds is what this
        // request asked; a credential that failed counts as nobody
        const resolved: PromiseSettledResult<ClaimedUser<string> | undefined>[] = await Promise.allSettled([
            ...this.principals.get(context)?.values() ?? [],
            ...this.claims.get(context)?.values() ?? []
        ]);
        return resolved.some(r => r.status === 'fulfilled' && r.value != undefined);
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
    async hasPermission(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        permission: Permission
    ): Promise<boolean> {
        this.reportUndeclaredPermission('tenant', 'hasPermission', permission);
        // a permission is what the roles of the membership the request already resolved carry in its
        // tenant, and one the credential may use
        const [membership, limits] = await Promise.all([
            this.resolveCheckedMembership(context, allowedStrategies),
            this.resolveCredentialLimits(context, allowedStrategies)
        ]);
        return membership != undefined
            && (limits?.permissions.includes(permission) ?? true)
            && (await this.roleService.resolvePermissionsOf(membership.roles, membership.tenantId)).includes(permission);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async hasPlatformPermission(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        permission: PlatformPermission
    ): Promise<boolean> {
        this.reportUndeclaredPermission('platform', 'hasPlatformPermission', permission);
        const [principal, limits] = await Promise.all([
            this.resolvePrincipal(context, allowedStrategies),
            this.resolveCredentialLimits(context, allowedStrategies)
        ]);
        return (limits?.permissions.includes(permission) ?? true)
            && this.roleService.resolvePlatformPermissionsOf(principal?.roles ?? []).includes(permission);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUserPermissions(user: BaseUser<string>, tenantId: string | undefined): Promise<(Permission | PlatformPermission)[]> {
        const memberships: BaseMembership<string>[] = tenantId == undefined
            ? await this.membershipService.findActiveMemberships(user.id)
            : [await this.membershipService.findActiveMembership(user.id, tenantId)].filter(membership => membership != undefined);
        // each membership in its own tenant, whose own roles may carry what the same name carries
        // nowhere else
        const permissions: (Permission | PlatformPermission)[] = [
            ...this.roleService.resolvePlatformPermissionsOf(user.roles),
            ...(await Promise.all(memberships.map(async m => await this.roleService.resolvePermissionsOf(m.roles, m.tenantId)))).flat()
        ];
        return [...new Set(permissions)];
    }

    /**
     * Narrows permissions to those the credential of a request may use.
     * @param permissions - The permissions the roles of the request's user carry.
     * @param limits - What the credential may do, or undefined for one acting with everything its user may.
     * @returns The permissions it holds.
     */
    private narrowToCredential<T extends Permission | PlatformPermission>(permissions: T[], limits: CredentialLimits | undefined): T[] {
        return limits == undefined ? permissions : permissions.filter(permission => limits.permissions.includes(permission));
    }

    /**
     * Warns once about each permission a check from the application's code names that is not
     * declared at its level. The check answers no for it, which is the same answer a typo would get
     * silently: the warning is what tells the two apart.
     * @param level - The level the check asks at.
     * @param check - The check, for the warning.
     * @param permission - The permission it was asked for.
     */
    private reportUndeclaredPermission(level: RoleLevel, check: string, permission: string): void {
        if (level === 'tenant' ? this.roleService.isPermission(permission) : this.roleService.isPlatformPermission(permission)) {
            return;
        }
        this.reportUndeclaredOnce(
            `${check}:${permission}`,
            `${check} was asked for the permission '${permission}', `
            + `which is not declared as a ${level} permission in ${PERMISSIONS_TOKEN}, and answers no.`
        );
    }

    /**
     * Warns, unless the same warning was given before.
     * @param key - What identifies the warning.
     * @param message - The warning.
     */
    private reportUndeclaredOnce(key: string, message: string): void {
        if (this.reportedUndeclared.has(key)) {
            return;
        }
        this.reportedUndeclared.add(key);
        this.logger.warn(message);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveCurrentMembership<
        Role extends string,
        MembershipType extends BaseMembership<Role>,
        B extends boolean = true
    >(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        required: B
    ): Promise<B extends false ? CurrentMembership<MembershipType> | undefined : CurrentMembership<MembershipType>> {
        const membership: BaseMembership<string> | undefined = await this.resolveMembership(context, allowedStrategies);
        if (membership == undefined) {
            if (required) {
                throw new ForbiddenError($ts`You do not have permission to access this route.`);
            }
            return undefined as B extends false ? CurrentMembership<MembershipType> | undefined : CurrentMembership<MembershipType>;
        }
        // without the roles, for the reason resolveCurrentUser gives: what they let the caller do is the
        // permissions of the current user
        // eslint-disable-next-line unusedImports/no-unused-vars
        const { roles, ...currentMembership } = membership;
        // the caller names the type of its memberships: the row is theirs, read through their repository
        return currentMembership as B extends false ? CurrentMembership<MembershipType> | undefined : CurrentMembership<MembershipType>;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveCredentialTenant(context: HttpRequestContext | WebsocketRequestContext): Promise<string | undefined> {
        // every strategy, for the reason isMemberOfActiveTenant gives
        const limits: CredentialLimits | undefined = await this.resolveCredentialLimits(context, this.strategies);
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
        return this.tenantService.getActiveTenantId() == undefined
            // every strategy rather than the ones the route names: whoever the request carries a
            // credential of acts in the tenant, whichever of them the route goes on to accept
            || await this.resolvePrincipal(context, this.strategies) == undefined
            || await this.resolveCheckedMembership(context, this.strategies) != undefined;
    }

    /**
     * Resolves the tenant and the roles of the membership a request acts through, as a check needs
     * them: off the credential while checks trust it and it carries them, read otherwise.
     * @param context - The request to resolve for.
     * @param allowedStrategies - The strategies that may answer who the request is from.
     * @returns The tenant and the roles, or undefined when there is no such membership.
     */
    private async resolveCheckedMembership(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<Pick<BaseMembership<string>, 'tenantId' | 'roles'> | undefined> {
        if (this.revalidateUsers) {
            return await this.resolveMembership(context, allowedStrategies);
        }
        const principal: ClaimedUser<string> | undefined = await this.resolvePrincipal(context, allowedStrategies);
        const tenantRoles: Readonly<Record<string, readonly string[]>> | undefined = principal?.tenantRoles;
        if (tenantRoles == undefined) {
            return await this.resolveMembership(context, allowedStrategies);
        }
        // trusting the credential saves the read of the user, and every request in a tenant would read
        // the membership still. As stale as the roles of the user's own, for the same reason
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        if (tenantId == undefined) {
            return undefined;
        }
        const limits: CredentialLimits | undefined = await this.resolveCredentialLimits(context, allowedStrategies);
        if (limits?.tenantId != undefined && limits.tenantId !== tenantId) {
            return undefined;
        }
        // own keys only: a tenant id named like something every object has is no membership
        const roles: readonly string[] | undefined = Object.hasOwn(tenantRoles, tenantId) ? tenantRoles[tenantId] : undefined;
        return roles == undefined ? undefined : { tenantId, roles: [...roles] };
    }

    /**
     * Resolves the membership a request acts through in the active tenant, once per request.
     * @param context - The request to resolve for.
     * @param allowedStrategies - The strategies that may answer who the request is from.
     * @returns The membership, or undefined when no tenant is active, nobody is logged in, the user is
     * no member of the tenant or the credential is bound to another one.
     */
    private async resolveMembership(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseMembership<string> | undefined> {
        return await this.memoizedIn(
            this.memberships,
            context,
            allowedStrategies.map(s => s.name).join(','),
            async () => await this.readMembership(context, allowedStrategies)
        );
    }

    private async readMembership(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseMembership<string> | undefined> {
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        const principal: ClaimedUser<string> | undefined = await this.resolvePrincipal(context, allowedStrategies);
        if (tenantId == undefined || principal == undefined) {
            return undefined;
        }
        const limits: CredentialLimits | undefined = await this.resolveCredentialLimits(context, allowedStrategies);
        return limits?.tenantId != undefined && limits.tenantId !== tenantId
            ? undefined
            // the roles as the membership holds them: what the credential may use of them is a matter of
            // permissions, and narrowed where those are resolved
            : await this.membershipService.findActiveMembership(principal.id, tenantId);
    }

    /**
     * Resolves what the credential of a request may do beyond being its user, once per request.
     * @param context - The request to resolve for.
     * @param allowedStrategies - The strategies that may answer who the request is from.
     * @returns The limits, or undefined when the request carries no credential or one acting with
     * everything its user may.
     */
    private async resolveCredentialLimits(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<CredentialLimits | undefined> {
        return await this.memoizedIn(
            this.credentialLimits,
            context,
            allowedStrategies.map(s => s.name).join(','),
            async () => await this.strategyFor(context, allowedStrategies)?.resolveCredentialLimits?.(context)
        );
    }

    /**
     * Resolves who the request is from, once per request.
     *
     * Every check is the same question about the same caller, so it is asked once: a route requiring
     * a login, a role and ownership resolved three times over before this. Keyed by the strategies
     * allowed for the check as well as by the request, because a route may narrow which of them
     * count - the same request with two different lists is two different questions.
     *
     * The authoritative answer is shared with resolveCurrentUser, which asks for exactly the same thing,
     * so a handler taking the current user does not pay for a second read of it.
     * @param context - The request to resolve for.
     * @param allowedStrategies - The strategies that may answer.
     * @returns Who the request is from, or undefined when no strategy recognizes it.
     */
    private async resolvePrincipal(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<ClaimedUser<string> | undefined> {
        return this.revalidateUsers
            // the account, unless this deployment said it would rather trust the credential: the same
            // answer resolveCurrentUser reads, so a handler taking the current user does not pay for it twice
            ? await this.resolveCurrentAccount(context, allowedStrategies)
            // a claimed principal is a different value than a resolved one, so the two never share an
            // entry - only the checks may take the claimed one, and resolveCurrentUser must not
            : await this.memoizedIn(
                this.claims,
                context,
                allowedStrategies.map(s => s.name).join(','),
                async () => await this.readClaimedPrincipal(context, allowedStrategies)
            );
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
        return await this.memoizedIn(this.principals, context, key, resolve);
    }

    /**
     * Runs the given resolution once per request, however often it is asked for, kept in the given
     * memo.
     * @param memo - Where the answers of each request are kept.
     * @param context - The request the answer belongs to.
     * @param key - What is being resolved, including whatever it depends on.
     * @param resolve - Produces the answer when it is not known yet.
     * @returns The answer.
     */
    private async memoizedIn<T>(
        memo: WeakMap<HttpRequestContext | WebsocketRequestContext, Map<string, Promise<T>>>,
        context: HttpRequestContext | WebsocketRequestContext,
        key: string,
        resolve: () => Promise<T>
    ): Promise<T> {
        const perRequest: Map<string, Promise<T>> = memo.get(context) ?? new Map<string, Promise<T>>();
        memo.set(context, perRequest);

        const pending: Promise<T> | undefined = perRequest.get(key);
        if (pending) {
            return await pending;
        }
        const resolving: Promise<T> = resolve();
        perRequest.set(key, resolving);
        return await resolving;
    }

    private async readClaimedPrincipal(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<ClaimedUser<string> | undefined> {
        const strategy: AuthStrategyInterface<string, BaseUser<string>> | undefined = this.strategyFor(context, allowedStrategies);
        if (!strategy) {
            return undefined;
        }
        return strategy.resolveClaimedUser == undefined
            // a strategy that cannot name a caller without reading does not offer a claim, and stays
            // authoritative whatever the setting says
            ? this.withoutDeactivated(await this.resolveUserOf(strategy, context))
            // a claim carries no deactivation, so a deactivated user's access token works until it
            // expires when the deployment trusts the credential; their logins have ended, so it is not
            // refreshed
            : await strategy.resolveClaimedUser(context);
    }

    private async readResolvedUser(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseUser<string> | undefined> {
        const strategy: AuthStrategyInterface<string, BaseUser<string>> | undefined = this.strategyFor(context, allowedStrategies);
        return strategy == undefined ? undefined : this.withoutDeactivated(await this.resolveUserOf(strategy, context));
    }

    /**
     * Resolves the user of a request with a strategy.
     * @param strategy - The strategy the request addresses.
     * @param context - The request.
     * @returns The user, or undefined when there is none, or when the strategy refused the request's
     * csrf token.
     */
    private async resolveUserOf(
        strategy: AuthStrategyInterface<string, BaseUser<string>>,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<BaseUser<string> | undefined> {
        try {
            return await strategy.resolveUser(context);
        }
        catch (error) {
            if (!(error instanceof CsrfTokenRefusedError)) {
                throw error;
            }
            // no login for what only reads who is calling, such as a route skipping auth or a login
            // started again, and the refusal itself where a login is needed, see runChecks
            this.csrfRefusals.set(context, error);
            return undefined;
        }
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
    async endLogins(userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        await Promise.all(this.findLoginStrategies().map(async strategy => await strategy.endLogins(userId, transaction)));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endFederatedLogins(session: FederatedSessionMatch, transaction: RepositoryTransaction | undefined): Promise<void> {
        await Promise.all(this.findLoginStrategies().map(async strategy => await strategy.endFederatedLogins(session, transaction)));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findLogins(
        userId: string,
        context: HttpRequestContext | WebsocketRequestContext | undefined,
        transaction: RepositoryTransaction | undefined
    ): Promise<UserLogin[]> {
        const current: CurrentLogin | undefined = context == undefined ? undefined : await this.resolveCurrentLogin(context);
        return (await this.findStrategyLogins(userId, transaction)).map(({ strategy, login }) => ({
            ...login,
            strategy: strategy.name,
            current: current?.strategy === strategy && current.loginId === login.id
        }));
    }

    /**
     * Finds the live logins of a user in every strategy that lists them, each with its strategy, the
     * most recently used first.
     * @param userId - The user.
     * @param transaction - The transaction to read in, if any.
     * @returns The logins.
     */
    private async findStrategyLogins(userId: string, transaction: RepositoryTransaction | undefined): Promise<StrategyLogin[]> {
        const byStrategy: StrategyLogin[][] = await Promise.all(this.findLoginListingStrategies().map(async strategy => {
            const listed: ListedLogin[] = await strategy.findLogins(userId, transaction);
            return listed.map(login => ({ strategy, login }));
        }));
        // the one most recently used first, which is the one a user looks for, and the last one a limit
        // on logins ends
        return byStrategy.flat().sort((a, b) => (b.login.lastUsedAt?.getTime() ?? 0) - (a.login.lastUsedAt?.getTime() ?? 0));
    }

    /**
     * Ends the logins of a user past the application's limit, the least recently used first, once a
     * login of theirs started.
     * @param userId - The user.
     * @param transaction - The transaction the login started in, which sees it.
     */
    private async endLoginsPastLimit(userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        const limit: number | undefined = inject(ZIBRI_DI_TOKENS.MAX_LOGINS_PER_USER);
        if (limit == undefined) {
            return;
        }
        const past: StrategyLogin[] = (await this.findStrategyLogins(userId, transaction)).slice(limit);
        await Promise.all(past.map(async ({ strategy, login }) => await strategy.endLogin(userId, login.id, transaction)));
        if (past.length) {
            this.auditService.record({ action: AuditAction.LOGIN_ENDED, outcome: AuditOutcome.SUCCESS, userId }, transaction);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endLogin(userId: string, loginId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        try {
            const ended: boolean[] = await Promise.all(
                this.findLoginListingStrategies().map(async strategy => await strategy.endLogin(userId, loginId, transaction))
            );
            if (!ended.includes(true)) {
                throw new NotFoundError($ts`There is no such login.`);
            }
            this.auditService.record({ action: AuditAction.LOGIN_ENDED, outcome: AuditOutcome.SUCCESS, userId }, transaction);
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.LOGIN_ENDED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endOwnLogins(userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        // endLogins with a line of its own in the trail: there it is what a reset or a deactivation
        // does, here what the user asked for
        try {
            await this.endLogins(userId, transaction);
            this.auditService.record({ action: AuditAction.LOGINS_ENDED, outcome: AuditOutcome.SUCCESS, userId }, transaction);
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.LOGINS_ENDED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async changePassword(
        userId: string,
        data: ChangePasswordData,
        context: HttpRequestContext | WebsocketRequestContext | undefined
    ): Promise<void> {
        try {
            const user: BaseUser<string> = await this.userService.findById(userId, { transaction: data.transaction });
            await inject(PasswordAuthenticator).changePassword(user, data);
            // every other login of the user, in every strategy: whoever else held one is the reason for
            // a change more often than not. The one asking stays, or changing a password would log
            // its user out
            const current: CurrentLogin | undefined = context == undefined ? undefined : await this.resolveCurrentLogin(context);
            await Promise.all(this.findLoginStrategies().map(async strategy => {
                if (current?.strategy !== strategy) {
                    await strategy.endLogins(user.id, data.transaction);
                    return;
                }
                const others: ListedLogin[] = (await current.strategy.findLogins(user.id, data.transaction))
                    .filter(login => login.id !== current.loginId);
                await Promise.all(others.map(async login => await current.strategy.endLogin(user.id, login.id, data.transaction)));
            }));
            this.auditService.record({ action: AuditAction.PASSWORD_CHANGED, outcome: AuditOutcome.SUCCESS, userId }, data.transaction);
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.PASSWORD_CHANGED,
                outcome: AuditOutcome.FAILURE,
                reason: error instanceof ForbiddenError ? AuditReason.REFUSED : AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Resolves the login a request carries, of a strategy that lists its logins.
     * @param context - The request.
     * @returns The strategy and the login, or undefined when the request carries none of those.
     */
    private async resolveCurrentLogin(context: HttpRequestContext | WebsocketRequestContext): Promise<CurrentLogin | undefined> {
        const strategy: AuthStrategyInterface<string, BaseUser<string>> | undefined = this.strategyFor(context, this.strategies);
        if (strategy == undefined || !isLoginAuthStrategy(strategy) || !isLoginListingAuthStrategy(strategy)) {
            return undefined;
        }
        const loginId: string | undefined = await strategy.resolveLoginId(context);
        return loginId == undefined ? undefined : { strategy, loginId };
    }

    /**
     * The registered strategies that list the logins of a user.
     * @returns Their instances.
     */
    private findLoginListingStrategies(): LoginListingAuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown>[] {
        return this.findLoginStrategies().filter(isLoginListingAuthStrategy);
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
        let ended: EndedLogin | undefined;
        try {
            ended = await inject(strategy).logout(data);
        }
        catch (error) {
            // the endpoint still answers as if it worked - a client that cannot log out has nothing
            // useful to do with the failure, and telling it would only leave the session it was
            // trying to drop. The record is what makes it visible at all: a logout that revoked
            // nothing is a live credential somebody believes is dead.
            this.auditService.record({
                action: AuditAction.LOGOUT,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error)
            });
            return {};
        }
        if (ended == undefined) {
            // what was presented named no login: spent, made up, or somebody else's that is gone.
            // Refused rather than a success, for the rule looking for a logout without a login
            this.auditService.record({ action: AuditAction.LOGOUT, outcome: AuditOutcome.FAILURE, reason: AuditReason.REFUSED });
            return {};
        }
        this.auditService.record({ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS, userId: ended.userId });
        return {
            providerLogoutUrl: ended.federatedSession == undefined ? undefined : await this.resolveProviderLogoutUrl(ended.federatedSession)
        };
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
        const authenticator: FederatedAuthenticatorClass | undefined = this.federatedAuthenticators.get(session.provider);
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