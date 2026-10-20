import { AuthStrategyInterface } from './auth-strategy.interface.ts';
import { ClientAccessTokenGrant } from './client-access-token-grant.model.ts';
import { IssuedClientAccessToken } from './issued-client-access-token.model.ts';
import { isTokenIntrospectingAuthStrategy, TokenIntrospectingAuthStrategyInterface } from './token-introspecting-auth-strategy.interface.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * Interface for an auth strategy that issues the access tokens the authorization server hands to
 * clients, and reads them.
 *
 * The authorization server issues its tokens through the one registered strategy implementing it, so
 * every token it issues is one the application takes. It answers for them at `/introspect` and
 * `/revoke` like any strategy answering for its tokens.
 */
export interface ClientAccessTokenIssuingAuthStrategyInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>
> extends TokenIntrospectingAuthStrategyInterface<RoleType, UserType> {
    /**
     * Issues an access token to a client, acting as the user of its api key.
     */
    issueClientAccessToken: (user: BaseUser<string>, grant: ClientAccessTokenGrant) => Promise<IssuedClientAccessToken>
}

/**
 * Checks whether or not the given auth strategy issues the access tokens of clients.
 * @param strategy - The strategy to check.
 * @returns True if all keys of the ClientAccessTokenIssuingAuthStrategyInterface are present, false otherwise.
 */
export function isClientAccessTokenIssuingAuthStrategy(
    strategy: AuthStrategyInterface<string, BaseUser<string>>
): strategy is ClientAccessTokenIssuingAuthStrategyInterface<string, BaseUser<string>> {
    return isTokenIntrospectingAuthStrategy(strategy) && 'issueClientAccessToken' in strategy;
}