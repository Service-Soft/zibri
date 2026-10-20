import { AuthStrategyInterface } from './auth-strategy.interface.ts';
import { HttpRequestContext } from '../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * Interface for an auth strategy whose requests carry a token against cross-site request forgery
 * besides the login itself.
 */
export interface CsrfTokenAuthStrategyInterface<RoleType extends string, UserType extends BaseUser<RoleType>>
    extends AuthStrategyInterface<RoleType, UserType> {
    /**
     * Resolves the token the client of the login a request carries sends with its requests. Undefined
     * when the request carries no valid login.
     */
    resolveCsrfToken: (context: HttpRequestContext | WebsocketRequestContext) => Promise<string | undefined>
}

/**
 * Checks whether or not the given auth strategy issues csrf tokens.
 * @param strategy - The strategy to check.
 * @returns True if it has every key CsrfTokenAuthStrategyInterface adds.
 */
export function isCsrfTokenAuthStrategy(
    strategy: AuthStrategyInterface<string, BaseUser<string>>
): strategy is CsrfTokenAuthStrategyInterface<string, BaseUser<string>> {
    return 'resolveCsrfToken' in strategy;
}