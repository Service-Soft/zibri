import { FederatedLoginAction } from './federated-login-action.type';

/**
 * What a provider's answer to a login is checked with.
 */
export type FederatedAnswerContext = {
    /**
     * What the login was started with, which the answer handed back.
     */
    state: string,
    /**
     * The secret of the cookie that ties the login to the browser, which what the provider had to
     * echo is derived from.
     */
    binding: string,
    /**
     * The scopes of the provider's apis the login asked for. Empty when it asked for none.
     */
    apiScopes: string[],
    /**
     * How long ago the user may have logged in at the provider for that login to count.
     */
    maxAuthenticationAgeInMs: number,
    /**
     * What the login is for.
     */
    action: FederatedLoginAction
};