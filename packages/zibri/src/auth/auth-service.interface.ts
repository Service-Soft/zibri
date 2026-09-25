import { Newable } from '../types/newable.type';
import { BaseUser } from './models/base-user.model';
import { HasRoleMetadata } from './models/has-role-metadata.model';
import { IsLoggedInMetadata } from './models/is-logged-in-metadata.model';
import { IsNotLoggedInMetadata } from './models/is-not-logged-in-metadata.model';
import { Require2faMetadata } from './models/require-2fa-metadata.model';
import { ResolvedRouteAuth } from './models/resolved-auth-metadata.model';
import { RouteAuthConfiguration } from './models/route-auth-configuration.model';
import { AuthStrategies } from './strategies/auth-strategies.model';
import { AuthStrategyInterface } from './strategies/auth-strategy.interface';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';

/**
 * Interface for an auth service.
 */
export interface AuthServiceInterface {
    /**
     * The different auth strategies provided.
     */
    readonly strategies: AuthStrategies,
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
     * Checks whether the currently logged in user has one of the provided roles.
     */
    hasRole: (
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        allowedRoles: string[]
    ) => Promise<boolean>,
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
     * Resolves the require 2fa metadata for the provided controller method.
     */
    resolveRequire2faMetadata: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => Require2faMetadata | undefined | Promise<Require2faMetadata | undefined>,
    /**
     * Logs in a user using the provided auth strategy and credentials.
     */
    login: <
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        credentials: CredentialsType
    ) => Promise<AuthDataType>,
    /**
     * Refreshes the login of a user using the provided auth strategy and refresh login data.
     */
    refreshLogin: <
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: RefreshLoginDataType
    ) => Promise<AuthDataType>,
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
     * Request a new password for a user using the provided auth strategy and request password reset data.
     */
    requestPasswordReset: <
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: RequestPasswordResetDataType
    ) => void | Promise<void>,
    /**
     * Confirms a new password for a user using the provided auth strategy and confirm password reset data.
     */
    confirmPasswordReset: <
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: ConfirmPasswordResetDataType
    ) => void | Promise<void>,
    /**
     * Logs out the current user.
     */
    logout: <
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: LogoutDataType
    ) => void | Promise<void>
}