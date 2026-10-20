import { FederatedProviderIdentity } from './federated-provider-identity.model.ts';
import { FederatedProviderSession } from './federated-provider-session.model.ts';
import { ProviderTokenGrant } from './provider-token-grant.model.ts';

/**
 * What a provider's verified answer to a sign-in proves: who signed in, and the tokens of its apis
 * when the sign-in asked for them.
 */
export type FederatedSignIn = {
    /**
     * Who signed in.
     */
    identity: FederatedProviderIdentity,
    /**
     * The tokens of the provider's apis the sign-in asked for. Undefined when it asked for none.
     */
    tokens: ProviderTokenGrant | undefined,
    /**
     * The session the user has at the provider, for a protocol that can end it. Undefined otherwise.
     */
    session?: FederatedProviderSession
};