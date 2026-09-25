import { AuthStrategies } from './auth-strategies.model';
import { ZibriApplication } from '../../application/application';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { OpenApiSecuritySchemeObject } from '../../open-api/open-api.model';
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
     * Whether the request carries this strategy's kind of credential at all.
     *
     * Asked before anything is resolved, and answered from the request alone - a header being there,
     * a cookie being set. Never whether the credential is any good: this is what decides *who is
     * being asked*, not whether they get in.
     *
     * Two things come out of it. A request is resolved by the one strategy it addresses rather than
     * by all of them at once, and a request addressing several is refused instead of quietly
     * authorizing as one identity while acting as another.
     */
    hasCredential: (context: HttpRequestContext | WebsocketRequestContext) => boolean,
    /**
     * Resolves the current user, as the data source currently has them.
     *
     * The authoritative answer, and the one every authorization check is decided on: a credential
     * says who its holder was when it was issued, which stops being true the moment an account is
     * deleted or a role is taken away.
     */
    resolveUser: (context: HttpRequestContext | WebsocketRequestContext) => Promise<UserType | undefined>,
    /**
     * Resolves who the credential claims to be, without reading anything.
     *
     * Optional, and only used when the DI token `REVALIDATE_USER_ON_AUTH_CHECK` is turned off - a
     * deployment trading immediate revocation for checks that touch no data source. Only the base
     * user is claimed, never the full entity, because a credential carries an identity rather than
     * a row.
     *
     * Leave it out unless the strategy really can name its caller from the request alone. A strategy
     * that has to read something to know who is calling gains nothing here and stays authoritative.
     */
    resolveClaimedUser?: (context: HttpRequestContext | WebsocketRequestContext) => Promise<BaseUser<RoleType> | undefined>,
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
        'confirmPasswordReset',
        'hasCredential',
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