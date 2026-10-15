import { AuthStrategyInterface } from './auth-strategy.interface';
import { IntrospectionResponse } from '../authorization-server/introspection-response.model';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an auth strategy that answers for the tokens it reads: whether one is active, and
 * revoking it.
 *
 * The authorization server asks every registered strategy implementing it at `/introspect` and
 * `/revoke`, so a token a strategy of your own reads is introspected and revoked there as well.
 */
export interface TokenIntrospectingAuthStrategyInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>
> extends AuthStrategyInterface<RoleType, UserType> {
    /**
     * Resolves whether a token is one of the strategy's own that may be used right now, and what it
     * says (RFC 7662, 2.2). Answers `{ active: false }` for any other token, one of its own that
     * expired or was revoked included, and for one whose user is gone or deactivated.
     */
    introspectToken: (token: string) => Promise<IntrospectionResponse>,
    /**
     * Revokes a token `introspectToken` answered as active. Throws an OAuth2Error
     * `unsupported_token_type` for a token of its own that cannot be revoked.
     */
    revokeToken: (token: string) => Promise<void>
}

/**
 * Checks whether or not the given auth strategy answers for the tokens it reads.
 * @param strategy - The strategy to check.
 * @returns True if all keys of the TokenIntrospectingAuthStrategyInterface are present, false otherwise.
 */
export function isTokenIntrospectingAuthStrategy(
    strategy: AuthStrategyInterface<string, BaseUser<string>>
): strategy is TokenIntrospectingAuthStrategyInterface<string, BaseUser<string>> {
    const keys: (keyof TokenIntrospectingAuthStrategyInterface<string, BaseUser<string>>)[] = ['introspectToken', 'revokeToken'];
    return keys.every(key => key in strategy);
}