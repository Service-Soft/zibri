import { AuthStrategies } from './auth-strategies.model';
import { CredentialLimits } from './credential-limits.model';
import { ZibriApplication } from '../../application/application';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { OpenApiSecuritySchemeObject } from '../../open-api/open-api.model';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an auth strategy: how a request says who it is from.
 *
 * A strategy turns a request into a user. One that also starts, refreshes and ends logins implements
 * `LoginAuthStrategyInterface`; one that reads a credential issued some other way, such as an api key,
 * implements only this.
 */
export interface AuthStrategyInterface<RoleType extends string, UserType extends BaseUser<RoleType>> {
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
     * Resolves when the caller last logged in.
     *
     * The login itself, not the last refresh of it: refreshing keeps the time of the login it
     * continues. Read by \@Auth.require2fa on a route that accepts a recent login in place of a
     * second factor.
     *
     * Answer undefined when the strategy cannot say, for example for a key that is never logged in
     * with. A caller without a time never counts as having logged in recently.
     */
    resolveAuthenticatedAt: (context: HttpRequestContext | WebsocketRequestContext) => Promise<Date | undefined>,
    /**
     * Resolves when the credential of the request stops being accepted on its own: the expiry of a
     * token, a key or a certificate. A socket that connected with the credential is checked again at
     * that time, and closed when the credential no longer resolves to its user.
     *
     * Answer undefined for a credential that does not expire, or when the request carries none.
     */
    resolveExpiresAt: (context: HttpRequestContext | WebsocketRequestContext) => Promise<Date | undefined>,
    /**
     * Resolves what the credential of the request may do beyond being its user.
     *
     * Optional: leave it out for a credential that acts with everything its user may do, which is
     * every login. An api key implements it, because a key may use only some of its user's roles and
     * may be bound to one tenant.
     */
    resolveCredentialLimits?: (context: HttpRequestContext | WebsocketRequestContext) => Promise<CredentialLimits | undefined>,
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
        'hasCredential',
        'name',
        'resolveAuthenticatedAt',
        'resolveExpiresAt',
        'resolveUser',
        'securityScheme'
    ];

    return keys.every(key => key in value);
}