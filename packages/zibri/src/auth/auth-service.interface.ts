import { BaseMembership } from '../tenancy/membership/base-membership.model';
import { Newable } from '../types/newable.type';
import { AuthenticatorInterface } from './authenticators/authenticator.interface';
import { Authenticators } from './authenticators/authenticators.model';
import { ConnectionCompletingAuthenticatorInterface } from './authenticators/connection-completing-authenticator.interface';
import { FederatedSessionMatch } from './authenticators/federated/federated-session-match.model';
import { IdentityLinkingAuthenticatorInterface } from './authenticators/identity-linking-authenticator.interface';
import { IdentityLinkingAuthenticators } from './authenticators/identity-linking-authenticators.model';
import { LinkedIdentity } from './authenticators/linked-identity.model';
import { ConfirmPasswordResetData } from './authenticators/password/confirm-password-reset-data.model';
import { RequestPasswordResetData } from './authenticators/password/request-password-reset-data.model';
import { BaseUser } from './models/base-user.model';
import { HasRoleMetadata } from './models/has-role-metadata.model';
import { IsLoggedInMetadata } from './models/is-logged-in-metadata.model';
import { IsNotLoggedInMetadata } from './models/is-not-logged-in-metadata.model';
import { LogoutResult } from './models/logout-result.model';
import { Require2faMetadata } from './models/require-2fa-metadata.model';
import { ResolvedRouteAuth } from './models/resolved-auth-metadata.model';
import { RouteAuthConfiguration } from './models/route-auth-configuration.model';
import { ApiKeyClientAuthentication } from './strategies/api-key/api-key-client-authentication.model';
import { ApiKeyCreateData } from './strategies/api-key/api-key-create-data.model';
import { ApiKey } from './strategies/api-key/api-key.model';
import { CreatedApiKey } from './strategies/api-key/created-api-key.model';
import { AuthStrategies } from './strategies/auth-strategies.model';
import { AuthStrategyInterface } from './strategies/auth-strategy.interface';
import { LoginAuthStrategyInterface } from './strategies/login-auth-strategy.interface';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Transaction } from '../data-source/transaction/transaction.model';
import { BaseEntity } from '../entity/base-entity.model';

/**
 * Interface for an auth service.
 */
export interface AuthServiceInterface {
    /**
     * The different auth strategies provided.
     */
    readonly strategies: AuthStrategies,
    /**
     * Resolves the registered strategies that have a capability, such as reading client certificates,
     * as its type guard tells them apart.
     */
    resolveStrategies: <Capable extends AuthStrategyInterface<string, BaseUser<string>>>(
        hasCapability: (strategy: AuthStrategyInterface<string, BaseUser<string>>) => strategy is Capable
    ) => Capable[],
    /**
     * The different authenticators provided.
     */
    readonly authenticators: Authenticators,
    /**
     * Checks if the provided method on the provided controller can be accessed by the current user.
     */
    checkAccess: (
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        context: HttpRequestContext | WebsocketRequestContext
    ) => Promise<void>,
    /**
     * Checks whether a manually registered route can be accessed by the current user.
     *
     * The same checks {@link AuthServiceInterface.checkAccess} runs, for a route that states its
     * posture as data because it has no class or method to decorate. A route that states nothing is
     * the same as a controller route carrying no decorators: the application's `defaultAuth` decides.
     */
    checkRouteAccess: (
        auth: RouteAuthConfiguration | undefined,
        context: HttpRequestContext | WebsocketRequestContext
    ) => Promise<void>,
    /**
     * Checks whether there is a currently logged in user.
     */
    isLoggedIn: (
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ) => Promise<boolean>,
    /**
     * Checks whether the currently logged in user holds one of the provided roles in the active
     * tenant, through their membership in it.
     */
    hasRole: (
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        allowedRoles: string[]
    ) => Promise<boolean>,
    /**
     * Checks whether the currently logged in user holds one of the provided roles of their own.
     */
    hasPlatformRole: (
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        allowedRoles: string[]
    ) => Promise<boolean>,
    /**
     * Gets the membership the currently logged in user acts through in the active tenant, its roles
     * narrowed to what the credential of the request may use.
     * @throws A ForbiddenError when it is required and there is none.
     */
    getCurrentMembership: <Role extends string, MembershipType extends BaseMembership<Role>, B extends boolean = true>(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        required: B
    ) => Promise<B extends false ? MembershipType | undefined : MembershipType>,
    /**
     * Resolves the tenant the credential of a request is bound to, such as an api key bound to one.
     *
     * A request naming no tenant acts in it.
     * @returns The tenant, or undefined when the request carries no credential or one acting in every
     * tenant of its user.
     */
    resolveCredentialTenant: (context: HttpRequestContext | WebsocketRequestContext) => Promise<string | undefined>,
    /**
     * Resolves when the credential of a request stops being accepted on its own, such as the expiry of
     * a token.
     * @returns The time, or undefined when the request carries no credential or one that does not expire.
     */
    resolveCredentialExpiry: (context: HttpRequestContext | WebsocketRequestContext) => Promise<Date | undefined>,
    /**
     * Checks whether reaching the provided method on the provided controller requires an
     * authenticated caller - including when it requires one only because the application declared
     * `defaultAuth: 'requireLogin'` and the route says nothing itself.
     */
    requiresAuthentication: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => boolean | Promise<boolean>,
    /**
     * Checks whether reaching a manually registered route requires an authenticated caller -
     * including when it requires one only because the application declared
     * `defaultAuth: 'requireLogin'` and the route states nothing itself.
     */
    requiresRouteAuthentication: (auth: RouteAuthConfiguration | undefined) => boolean,
    /**
     * Resolves everything the \@Auth decorators of the provided controller method and its controller
     * mean for a caller, the application wide default included.
     *
     * Called while the route is registered - resolving a declaration is where an impossible one is
     * refused and where the "Useless @Auth.skip" warnings come from, and both belong to booting.
     * Whoever serves a request reads the answer back out of the route registry instead.
     */
    resolveRouteAuth: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => ResolvedRouteAuth,
    /**
     * Resolves the is logged in metadata for the provided controller method.
     * (Whether it's required to be logged in, etc.).
     */
    resolveIsLoggedInMetadata: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => IsLoggedInMetadata | undefined | Promise<IsLoggedInMetadata | undefined>,
    /**
     * Resolves the is not logged in metadata for the provided controller method.
     * (Whether it's required to be logged out, etc.).
     */
    resolveIsNotLoggedInMetadata: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => IsNotLoggedInMetadata | undefined | Promise<IsNotLoggedInMetadata | undefined>,
    /**
     * Resolves the has role metadata for the provided controller method.
     * (Whether it's required for the user to have a certain role etc.).
     */
    resolveHasRoleMetadata: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => HasRoleMetadata | undefined | Promise<HasRoleMetadata | undefined>,
    /**
     * Resolves the has platform role metadata for the provided controller method.
     */
    resolveHasPlatformRoleMetadata: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => HasRoleMetadata | undefined | Promise<HasRoleMetadata | undefined>,
    /**
     * Resolves the require 2fa metadata for the provided controller method.
     */
    resolveRequire2faMetadata: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => Require2faMetadata | undefined | Promise<Require2faMetadata | undefined>,
    /**
     * Authenticates the provided credentials with the provided authenticator, and starts a login of
     * the provided auth strategy for the user they belong to.
     *
     * The only way to start a login: every one is for credentials an authenticator checked.
     */
    login: <
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
    ) => Promise<AuthDataType>,
    /**
     * Reads who signed in through the provided authenticator, for creating the user they become, from
     * the ticket a first sign-in continues with. Does not spend the ticket.
     */
    resolveRegistration: <
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
    ) => Promise<RegistrationType>,
    /**
     * Links the identity a ticket of the provided authenticator names to a user, so the ticket logs
     * them in and every later sign-in with the identity finds them. Does not spend the ticket.
     */
    linkIdentity: <
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
    ) => Promise<void>,
    /**
     * Starts connecting an identity of the provided authenticator to the user logged in with the
     * current request, as the request says. Answers with what the browser needs to go on with it: the
     * url to send it to for a provider, the options to create a passkey with for a passkey.
     */
    startConnection: <
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
    ) => Promise<ConnectionStartType>,
    /**
     * Finishes connecting an identity of the provided authenticator to the user logged in with the
     * current request, with what the client answered to the connection started for them, such as the
     * passkey a device created.
     */
    completeConnection: <Role extends string, UserType extends BaseUser<Role>, CredentialsType, ConnectionAnswerType>(
        authenticator: Newable<ConnectionCompletingAuthenticatorInterface<Role, UserType, CredentialsType, ConnectionAnswerType>>,
        answer: ConnectionAnswerType
    ) => Promise<void>,
    /**
     * Finds the identities linked to a user, each with the name of the authenticator it is linked
     * through. Of every authenticator that links identities, or of the provided ones only.
     */
    findIdentities: {
        (userId: string, transaction: Transaction | undefined): Promise<LinkedIdentity[]>,
        <IdentityType extends Pick<BaseEntity, 'id'>>(
            userId: string,
            transaction: Transaction | undefined,
            authenticators: IdentityLinkingAuthenticators<IdentityType>
        ): Promise<LinkedIdentity<IdentityType>[]>
    },
    /**
     * Unlinks an identity from a user, whichever authenticator it signs in through.
     */
    unlinkIdentity: (userId: string, identityId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Resolves an access token for calling a provider's apis for a user, with an identity of theirs
     * whose tokens are kept, that has been granted the provided scopes. Asks the provider for a new one
     * when the kept one has expired. Throws a ProviderAccessError saying why when there is none.
     */
    resolveProviderAccessToken: (userId: string, identityId: string, scopes: string[]) => Promise<string>,
    /**
     * Stops keeping the tokens of an identity of a user, and hands them back to the provider. An
     * identity that does not sign in is unlinked.
     */
    revokeProviderAccess: (userId: string, identityId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Stops an identity of a user from signing in as them, and keeps the provider's tokens for its
     * apis. An identity without api access is unlinked. Connecting it again to sign in turns signing in
     * on again.
     */
    revokeProviderSignIn: (userId: string, identityId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Creates an api key for a user, with the roles the key may use. A key that is a secret is sent
     * by a request to act as the user through ApiKeyAuthStrategy, and answers with the key itself,
     * which is only ever handed out here. A key with `clientAuthentication` has no secret, and proves
     * itself that way at the token endpoint of the authorization server.
     */
    createApiKey: {
        <Role extends string>(
            userId: string,
            data: ApiKeyCreateData<Role, undefined>,
            transaction: Transaction | undefined
        ): Promise<CreatedApiKey>,
        <Role extends string>(
            userId: string,
            data: ApiKeyCreateData<Role, ApiKeyClientAuthentication>,
            transaction: Transaction | undefined
        ): Promise<ApiKey>
    },
    /**
     * Finds the api keys of a user, expired ones included, oldest first.
     */
    findApiKeys: (userId: string, transaction: Transaction | undefined) => Promise<ApiKey[]>,
    /**
     * Revokes an api key of a user. Throws a NotFoundError when the user has no key with that id.
     */
    revokeApiKey: (userId: string, apiKeyId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Revokes every api key of a user.
     */
    revokeApiKeys: (userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Deactivates a user: ends their logins and revokes their api keys. Until they are reactivated
     * they cannot log in, and no request acts as them.
     */
    deactivateUser: (userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Reactivates a deactivated user, who can log in again. Their revoked api keys stay revoked.
     */
    reactivateUser: (userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Ends every login of a user and revokes their api keys. Unlike deactivating, it leaves them able to
     * log in again.
     */
    endAccess: (userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Refreshes the login of a user using the provided auth strategy and refresh login data.
     */
    refreshLogin: <
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<LoginAuthStrategyInterface<Role, UserType, AuthDataType, RefreshLoginDataType, LogoutDataType>>,
        data: RefreshLoginDataType
    ) => Promise<AuthDataType>,
    /**
     * Resolves the user a refresh of their login continues as, from every authenticator that has a say
     * in refreshes. A login strategy calls it before it rotates anything. When one of them answers with
     * an AccountDeactivatedError, the user's access is ended once the transaction is finished, and the
     * error is thrown on.
     */
    resolveRefreshUser: <Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        transaction: Transaction | undefined
    ) => Promise<UserType>,
    /**
     * Get's the currently logged in user. When required is set to false this can return undefined.
     */
    getCurrentUser: <
        Role extends string,
        UserType extends BaseUser<Role>,
        B extends boolean = true
    >(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        required: B
    ) => Promise<B extends false ? UserType | undefined : UserType>,
    /**
     * Mails the provided user a link to reset their password with.
     */
    requestPasswordReset: <Role extends string, UserType extends BaseUser<Role>>(
        data: RequestPasswordResetData<Role, UserType>
    ) => Promise<void>,
    /**
     * Whether a reset link still resets a password: its token is known, has not expired, and its user
     * still exists.
     */
    isPasswordResetTokenValid: (resetToken: string) => Promise<boolean>,
    /**
     * Sets the new password of the user a reset link was sent to, and ends every login of theirs.
     */
    confirmPasswordReset: (data: ConfirmPasswordResetData) => Promise<void>,
    /**
     * Ends every login of the provided user, in every auth strategy.
     */
    endLogins: (userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Ends the logins started from a session at a provider, in every auth strategy, once the user
     * logged out there.
     */
    endFederatedLogins: (session: FederatedSessionMatch, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Logs out the current user.
     * @returns Where to send the browser to log out at the provider the login was started at too, if any.
     */
    logout: <
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<LoginAuthStrategyInterface<Role, UserType, AuthDataType, RefreshLoginDataType, LogoutDataType>>,
        data: LogoutDataType
    ) => Promise<LogoutResult>
}