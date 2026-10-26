import { FederatedLoginAction } from '../federated/federated-login-action.type';

/**
 * What the answer to a login is checked and exchanged with, worked out from the attempt it answers.
 */
export type OAuthCodeExchange = {
    /**
     * The state the login was started with.
     */
    state: string,
    /**
     * The PKCE verifier whose challenge the login was started with.
     */
    codeVerifier: string,
    /**
     * The nonce the login was started with, for a provider that puts it into an ID token.
     */
    nonce: string,
    /**
     * How long ago the user may have logged in at the provider, in seconds.
     */
    maxAgeInSeconds: number,
    /**
     * What the login is for.
     */
    action: FederatedLoginAction
};