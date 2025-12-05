import { BaseEntity } from '../../entity/base-entity.model';
import { HttpRequest } from '../../http';
import { OpenApiSecuritySchemeObject } from '../../open-api';
import { Newable } from '../../types';
import { WebsocketRequest } from '../../websocket';
import { BaseUser } from '../models';

/**
 * Interface for an auth strategy.
 */
export interface AuthStrategyInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    AuthDataType,
    CredentialType,
    RequestPasswordResetDataType,
    ConfirmPasswordResetDataType,
    RefreshLoginDataType,
    LogoutData
> {
    /**
     * Initializes the strategy.
     */
    init: () => void,
    /**
     * Resolves the current user.
     */
    resolveUser: (request: HttpRequest | WebsocketRequest) => Promise<UserType | undefined>,
    /**
     * Logs in a user.
     */
    login: (credentials: CredentialType) => Promise<AuthDataType>,
    /**
     * Logs out the current user.
     */
    logout: (data: LogoutData) => Promise<void>,
    /**
     * Refreshes the login of a user.
     */
    refreshLogin: (data: RefreshLoginDataType) => Promise<AuthDataType>,
    /**
     * Checks whether a user is currently logged in.
     */
    isLoggedIn: (request: HttpRequest | WebsocketRequest) => Promise<boolean>,
    /**
     * Checks whether a currently logged in user has one of the provided roles.
     */
    hasRole: (request: HttpRequest | WebsocketRequest, allowedRoles: RoleType[]) => Promise<boolean>,
    /**
     * Checks whether a currently logged belongs to the requested resource.
     */
    belongsTo: <TargetEntity extends Newable<BaseEntity>>(
        request: HttpRequest | WebsocketRequest,
        targetEntity: TargetEntity,
        targetUserIdKey: keyof InstanceType<TargetEntity>,
        targetIdParamKey: string
    ) => Promise<boolean>,
    /**
     * Request a new password for a user using the request password reset data.
     */
    requestPasswordReset: (data: RequestPasswordResetDataType) => void | Promise<void>,
    /**
     * Confirms a new password for a user using the provided confirm password reset data.
     */
    confirmPasswordReset: (data: ConfirmPasswordResetDataType) => void | Promise<void>,
    /**
     * The security scheme object to be used by open api.
     */
    securityScheme: OpenApiSecuritySchemeObject,
    /**
     * The name of the auth strategy.
     */
    name: string
}