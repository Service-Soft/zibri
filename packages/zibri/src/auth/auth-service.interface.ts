import { BaseMembership } from '../tenancy/membership/base-membership.model';
import { type CurrentMembership } from '../tenancy/membership/current-membership.model';
import { Newable } from '../types/newable.type';
import { TwoFactorMethod } from './2fa/methods/two-factor-method.interface';
import { AuthenticatorInterface } from './authenticators/authenticator.interface';
import { Authenticators } from './authenticators/authenticators.model';
import { type FederatedAuthenticatorClass } from './authenticators/federated/federated-route.utilities';
import { FederatedSessionMatch } from './authenticators/federated/federated-session-match.model';
import { IdentityLinkingAuthenticatorInterface } from './authenticators/identity-linking-authenticator.interface';
import { IdentityLinkingAuthenticators } from './authenticators/identity-linking-authenticators.model';
import { LinkIdentityConfirmingAuthenticatorInterface } from './authenticators/link-identity-confirming-authenticator.interface';
import { LinkedIdentity } from './authenticators/linked-identity.model';
import { ChangePasswordData } from './authenticators/password/change-password-data.model';
import { ConfirmPasswordResetData } from './authenticators/password/confirm-password-reset-data.model';
import { RequestPasswordResetData } from './authenticators/password/request-password-reset-data.model';
import { type CurrentUser } from './decorators/current-user.decorator';
import { BaseUser } from './models/base-user.model';
import { LogoutResult } from './models/logout-result.model';
import { RouteAuthConfiguration } from './models/route-auth-configuration.model';
import { UserLogin } from './models/user-login.model';
import { type Permission } from './roles/permission.type';
import { type PlatformPermission } from './roles/platform-permission.type';
import { BaseEntity } from '../entity/base-entity.model';
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
     * Finds the registered authenticator that logs users in at the provider of the given name.
     */
    findFederatedAuthenticator: (provider: string) => FederatedAuthenticatorClass | undefined,
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
     * Resolves whether a check or the handler of this request found out which user sent it, which is
     * what makes an answer depend on who asked. Resolves no user itself.
     */
    resolveIsCallerIdentified: (context: HttpRequestContext | WebsocketRequestContext) => Promise<boolean>,
    /**
     * Checks whether one of the roles the currently logged in user holds in the active tenant, through
     * their membership in it, carries the provided permission.
     *
     * A permission that is not declared as a tenant permission in `ZIBRI_DI_TOKENS.PERMISSIONS` is
     * carried by no role, and is reported once as a warning.
     */
    hasPermission: (
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        permission: Permission
    ) => Promise<boolean>,
    /**
     * Checks whether one of the roles of the currently logged in user's own carries the provided
     * permission.
     *
     * A permission that is not declared as a platform permission in `ZIBRI_DI_TOKENS.PERMISSIONS` is
     * carried by no role, and is reported once as a warning.
     */
    hasPlatformPermission: (
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        permission: PlatformPermission
    ) => Promise<boolean>,
    /**
     * Resolves the permissions a user's roles carry: of their own, and of their membership in a
     * tenant, or of every membership of theirs when none is named. For what a credential may do
     * outside of a request, such as the scope of a token.
     * @param user - The user.
     * @param tenantId - The tenant, or undefined for every tenant the user is a member of.
     * @returns The permissions, each once.
     */
    resolveUserPermissions: (user: BaseUser<string>, tenantId: string | undefined) => Promise<(Permission | PlatformPermission)[]>,
    /**
     * Resolves the membership the currently logged in user acts through in the active tenant, without
     * its roles: what they let the caller do, narrowed to what the credential of the request may use,
     * is in the `permissions` of {@link AuthServiceInterface.resolveCurrentUser}.
     * @throws A ForbiddenError when it is required and there is none.
     */
    resolveCurrentMembership: <Role extends string, MembershipType extends BaseMembership<Role>, B extends boolean = true>(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        required: B
    ) => Promise<B extends false ? CurrentMembership<MembershipType> | undefined : CurrentMembership<MembershipType>>,
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
     * Refuses permissions a credential cannot list, such as those of a new api key.
     * @throws A BadRequestError when a permission is declared at neither level.
     */
    validatePermissions: (permissions: string[]) => void,
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
     * Requests the second factor of a login that waits for one, with the given method: sends the user a
     * code, or answers with a challenge for their device.
     *
     * The ticket is the one the login answered with, in its `SecondFactorRequiredError`.
     */
    requestSecondFactorAtLogin: <
        TwoFactorRegistrationRequestData,
        TwoFactorRegistrationConfirmData,
        SecondFactorRequestType
    >(
        ticket: string,
        method: TwoFactorMethod<TwoFactorRegistrationRequestData, TwoFactorRegistrationConfirmData, unknown, SecondFactorRequestType>
    ) => Promise<SecondFactorRequestType>,
    /**
     * Requests the registration of the given two factor method for the user of a login that waits for
     * a second factor, who has none yet.
     * @throws A `ForbiddenError` when the user has a second factor, which a login presents instead.
     */
    requestTwoFactorRegistrationAtLogin: <
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
    ) => Promise<TwoFactorRegistrationRequestResult>,
    /**
     * Confirms the registration of the given two factor method for the user of a login that waits for
     * a second factor, who has none yet.
     * @throws A `ForbiddenError` when the user has a second factor, which a login presents instead.
     */
    confirmTwoFactorRegistrationAtLogin: <
        TwoFactorRegistrationRequestData,
        TwoFactorRegistrationConfirmData
    >(
        ticket: string,
        method: TwoFactorMethod<TwoFactorRegistrationRequestData, TwoFactorRegistrationConfirmData, unknown, unknown>,
        data: TwoFactorRegistrationConfirmData
    ) => Promise<void>,
    /**
     * Confirms the second factor of a login that waits for one, with the factor the current request
     * presents, and starts the login of the provided auth strategy. Spends the ticket.
     */
    confirmSecondFactorAtLogin: <
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        ticket: string,
        strategy: Newable<LoginAuthStrategyInterface<Role, UserType, AuthDataType, RefreshLoginDataType, LogoutDataType>>,
        transaction: Transaction | undefined
    ) => Promise<AuthDataType>,
    /**
     * Reads who logged in through the provided authenticator, for creating the user they become, from
     * the ticket a first login continues with. Does not spend the ticket.
     */
    resolveRegistration: <
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
        transaction: Transaction | undefined
    ) => Promise<RegistrationType>,
    /**
     * Links the identity a ticket of the provided authenticator names to a user, so the ticket logs
     * them in and every later login with the identity finds them. Does not spend the ticket.
     */
    linkTicketIdentity: <
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
        transaction: Transaction | undefined
    ) => Promise<void>,
    /**
     * Requests linking an identity of the provided authenticator to the user logged in with the
     * current request, as the request says. Answers with what the browser needs to go on with it: the
     * url to send it to for a provider, the options to create a passkey with for a passkey.
     */
    requestLinkIdentity: <
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
    ) => Promise<LinkIdentityStartType>,
    /**
     * Confirms linking an identity of the provided authenticator to the user logged in with the
     * current request, with what the client answered to the link requested for them, such as the
     * passkey a device created.
     */
    confirmLinkIdentity: <Role extends string, UserType extends BaseUser<Role>, CredentialsType, LinkIdentityAnswerType>(
        authenticator: Newable<LinkIdentityConfirmingAuthenticatorInterface<Role, UserType, CredentialsType, LinkIdentityAnswerType>>,
        answer: LinkIdentityAnswerType
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
     * Unlinks an identity from a user, whichever authenticator it logs in through.
     */
    unlinkIdentity: (userId: string, identityId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Deletes every row auth keeps for the given users: what each registered authenticator, auth
     * strategy and two factor method keeps for them, their api keys, failure streaks and login tickets.
     * Called in the transaction that deletes the users for good, so a user is never gone while their
     * passwords, second factors or sessions stay; a soft deleted user keeps them.
     */
    deleteUserRows: (userIds: string[], transaction: Transaction) => Promise<void>,
    /**
     * Resolves an access token for calling a provider's apis for a user, with an identity of theirs
     * whose tokens are kept, that has been granted the provided scopes. Asks the provider for a new one
     * when the kept one has expired. Throws a ProviderAccessError saying why when there is none.
     */
    resolveProviderAccessToken: (userId: string, identityId: string, scopes: string[]) => Promise<string>,
    /**
     * Stops keeping the tokens of an identity of a user, and hands them back to the provider. An
     * identity that does not log in is unlinked.
     */
    revokeProviderAccess: (userId: string, identityId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Stops an identity of a user from logging in as them, and keeps the provider's tokens for its
     * apis. An identity without api access is unlinked. Connecting it again to log in turns logging in
     * on again.
     */
    revokeProviderLogin: (userId: string, identityId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Creates an api key for a user, with the permissions the key may use. A key that is a secret is
     * sent by a request to act as the user through ApiKeyAuthStrategy, and answers with the key itself,
     * which is only ever handed out here. A key with `clientAuthentication` has no secret, and proves
     * itself that way at the token endpoint of the authorization server.
     */
    createApiKey: {
        (
            userId: string,
            data: ApiKeyCreateData<undefined>,
            transaction: Transaction | undefined
        ): Promise<CreatedApiKey>,
        (
            userId: string,
            data: ApiKeyCreateData<ApiKeyClientAuthentication>,
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
     * Resolves the currently logged in user, without their roles and with the permissions the request
     * may use, in the active tenant and of their own. When required is set to false this can return
     * undefined.
     */
    resolveCurrentUser: <
        Role extends string,
        UserType extends BaseUser<Role>,
        B extends boolean = true
    >(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        required: B
    ) => Promise<B extends false ? CurrentUser<UserType> | undefined : CurrentUser<UserType>>,
    /**
     * Mails the provided user a link to reset their password with.
     */
    requestPasswordReset: <Role extends string, UserType extends BaseUser<Role>>(
        data: RequestPasswordResetData<Role, UserType>
    ) => Promise<void>,
    /**
     * Mails whoever holds the provided address a link to reset their password with, and records the
     * request in the audit trail.
     *
     * Resolves once the address is looked up, whether or not anybody holds it. The link and its mail
     * follow in the background, so the time it takes says nothing about the address, and a shutdown
     * waits for them.
     */
    requestPasswordResetForEmail: (email: string) => Promise<void>,
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
     * Finds the live logins of a user, in every strategy that lists them, the most recently used
     * first. With the request asking, the login it carries is marked `current`.
     */
    findLogins: (
        userId: string,
        context: HttpRequestContext | WebsocketRequestContext | undefined,
        transaction: Transaction | undefined
    ) => Promise<UserLogin[]>,
    /**
     * Ends one login of a user, by the id `findLogins` lists it with, and records it.
     * @throws A NotFoundError when the user has no such login.
     */
    endLogin: (userId: string, loginId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Ends every login of a user in every auth strategy, as `endLogins` does, and records it as asked
     * for by the user.
     */
    endOwnLogins: (userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Sets a new password for a user who knows the current one, ends every other login of theirs and
     * records it. With the request asking, the login it carries stays.
     * @throws A ForbiddenError when the current password is wrong.
     */
    changePassword: (
        userId: string,
        data: ChangePasswordData,
        context: HttpRequestContext | WebsocketRequestContext | undefined
    ) => Promise<void>,
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