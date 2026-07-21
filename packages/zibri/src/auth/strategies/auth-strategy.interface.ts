import { AuthStrategies } from './auth-strategies.model';
import { ZibriApplication } from '../../application';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { BaseEntity } from '../../entity/base-entity.model';
import { OpenApiSecuritySchemeObject } from '../../open-api/open-api.model';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

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
     * Initializes the auth strategy.
     */
    init?: (app: ZibriApplication) => void | Promise<void>,
    /**
     * Resolves the current user.
     */
    resolveUser: (context: HttpRequestContext | WebsocketRequestContext) => Promise<UserType | undefined>,
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
    isLoggedIn: (context: HttpRequestContext | WebsocketRequestContext) => Promise<boolean>,
    /**
     * Checks whether a currently logged in user has one of the provided roles.
     */
    hasRole: (context: HttpRequestContext | WebsocketRequestContext, allowedRoles: RoleType[]) => Promise<boolean>,
    /**
     * Checks whether a currently logged belongs to the requested resource.
     */
    belongsTo: <TargetEntity extends Newable<BaseEntity>>(
        context: HttpRequestContext | WebsocketRequestContext,
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

/**
 * Checks whether or not the given value is a auth strategy.
 * @param value - The value to check.
 * @returns True if all keys of the AuthStrategyInterface are present, false otherwise.
 */
export function isAuthStrategy(value: unknown): value is InstanceType<AuthStrategies[number]> {
    if (value == undefined) {
        return false;
    }
    if (typeof value !== 'object') {
        return false;
    }

    const keys: (keyof InstanceType<AuthStrategies[number]>)[] = [
        'belongsTo',
        'confirmPasswordReset',
        'hasRole',
        'isLoggedIn',
        'login',
        'logout',
        'name',
        'refreshLogin',
        'requestPasswordReset',
        'resolveUser',
        'securityScheme'
    ];

    return !keys.find(key => !(key in value));
}