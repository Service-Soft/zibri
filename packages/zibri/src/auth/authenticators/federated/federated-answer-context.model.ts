import { FederatedSignInAction } from './federated-sign-in-action.type';

/**
 * What a provider's answer to a sign-in is checked with.
 */
export type FederatedAnswerContext = {
    /**
     * What the sign-in was started with, which the answer handed back.
     */
    state: string,
    /**
     * The secret of the cookie that ties the sign-in to the browser, which what the provider had to
     * echo is derived from.
     */
    binding: string,
    /**
     * The scopes of the provider's apis the sign-in asked for. Empty when it asked for none.
     */
    apiScopes: string[],
    /**
     * How long ago the user may have signed in at the provider for that sign-in to count.
     */
    maxAuthenticationAgeInMs: number,
    /**
     * What the sign-in is for.
     */
    action: FederatedSignInAction
};