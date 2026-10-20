import { FederatedSignInAction } from '../federated/federated-sign-in-action.type.ts';

/**
 * What the answer to a sign-in is checked and exchanged with, worked out from the attempt it answers.
 */
export type OAuthCodeExchange = {
    /**
     * The state the sign-in was started with.
     */
    state: string,
    /**
     * The PKCE verifier whose challenge the sign-in was started with.
     */
    codeVerifier: string,
    /**
     * The nonce the sign-in was started with, for a provider that puts it into an ID token.
     */
    nonce: string,
    /**
     * How long ago the user may have signed in at the provider, in seconds.
     */
    maxAgeInSeconds: number,
    /**
     * What the sign-in is for.
     */
    action: FederatedSignInAction
};