import { BaseEntity } from '../entity';
import { HttpRequest } from '../http';
import { Newable } from '../types';
import { AuthStrategyInterface } from './auth-strategy.interface';
import { AuthStrategies, BaseUser, BelongsToMetadata, HasRoleMetadata, IsLoggedInMetadata, IsNotLoggedInMetadata } from './models';

/**
 * Interface for an auth service.
 */
export interface AuthServiceInterface {
    /**
     * The different auth strategies provided.
     */
    readonly strategies: AuthStrategies,
    /**
     * Initializes the service.
     */
    init: (strategies: AuthStrategies) => void,
    /**
     * Checks if the provided method on the provided controller can be accessed by the current user.
     */
    checkAccess: (controllerClass: Newable<unknown>, controllerMethod: string, req: HttpRequest) => Promise<void>,
    /**
     * Checks whether there is a currently logged in user.
     */
    isLoggedIn: (request: HttpRequest, allowedStrategies: AuthStrategies) => Promise<boolean>,
    /**
     * Checks whether the currently logged in user has one of the provided roles.
     */
    hasRole: (request: HttpRequest, allowedStrategies: AuthStrategies, allowedRoles: string[]) => Promise<boolean>,
    /**
     * Checks whether the currently logged in user belongs to the target entity.
     */
    belongsTo: <TargetEntity extends Newable<BaseEntity>>(
        request: HttpRequest,
        allowedStrategies: AuthStrategies,
        targetEntity: TargetEntity,
        targetUserIdKey: keyof InstanceType<TargetEntity>,
        targetIdParamKey: string
    ) => Promise<boolean>,
    /**
     * Resolves the is logged in metadata for the provided controller method.
     * (Whether it's required to be logged in, etc.).
     */
    resolveIsLoggedInMetadata: (controllerClass: Newable<unknown>, controllerMethod: string) => IsLoggedInMetadata | undefined,
    /**
     * Resolves the is not logged in metadata for the provided controller method.
     * (Whether it's required to be logged out, etc.).
     */
    resolveIsNotLoggedInMetadata: (controllerClass: Newable<unknown>, controllerMethod: string) => IsNotLoggedInMetadata | undefined,
    /**
     * Resolves the has role metadata for the provided controller method.
     * (Whether it's required for the user to have a certain role etc.).
     */
    resolveHasRoleMetadata: (controllerClass: Newable<unknown>, controllerMethod: string) => HasRoleMetadata | undefined,
    /**
     * Resolves the belongs to metadata for the provided controller method.
     * (Whether it's required for the user to somehow belong to the requested entity, etc.).
     */
    resolveBelongsToMetadata: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => BelongsToMetadata<Newable<BaseEntity>> | undefined,
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
        RefreshLoginDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType
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
        RefreshLoginDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType
            >
        >,
        data: RefreshLoginDataType
    ) => Promise<AuthDataType>,
    /**
     * Get's the currently logged in user. When required is set to false this can return undefined.
     */
    getCurrentUser: <Role extends string, UserType extends BaseUser<Role>, B extends boolean = true>(
        request: HttpRequest,
        strategies: AuthStrategies,
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
        RefreshLoginDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType
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
        RefreshLoginDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType
            >
        >,
        data: ConfirmPasswordResetDataType
    ) => void | Promise<void>
}