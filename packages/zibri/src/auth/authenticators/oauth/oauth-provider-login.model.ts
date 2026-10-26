import type { TokenEndpointResponse } from 'openid-client';

import { FederatedProviderIdentity } from '../federated/federated-provider-identity.model';
import { FederatedProviderSession } from '../federated/federated-provider-session.model';

/**
 * A login at a provider, as its answer proves it: who logged in, and the tokens the code was
 * exchanged for.
 */
export type OAuthProviderLogin = {
    /**
     * Who logged in, and when.
     */
    identity: FederatedProviderIdentity,
    /**
     * What the provider's token endpoint answered with.
     */
    tokens: TokenEndpointResponse,
    /**
     * The session the user has at the provider, for a provider that can end it. Undefined otherwise.
     */
    session?: FederatedProviderSession
};