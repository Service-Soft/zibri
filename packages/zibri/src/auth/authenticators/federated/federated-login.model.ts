import { FederatedProviderIdentity } from './federated-provider-identity.model';
import { FederatedProviderSession } from './federated-provider-session.model';
import { ProviderTokenGrant } from './provider-token-grant.model';

/**
 * What a provider's verified answer to a login proves: who logged in, and the tokens of its apis
 * when the login asked for them.
 */
export type FederatedLogin = {
    /**
     * Who logged in.
     */
    identity: FederatedProviderIdentity,
    /**
     * The tokens of the provider's apis the login asked for. Undefined when it asked for none.
     */
    tokens: ProviderTokenGrant | undefined,
    /**
     * The session the user has at the provider, for a protocol that can end it. Undefined otherwise.
     */
    session?: FederatedProviderSession
};