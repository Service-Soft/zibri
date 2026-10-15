import type { TokenEndpointResponse } from 'openid-client';

import { FederatedProviderIdentity } from '../federated/federated-provider-identity.model';

/**
 * A sign-in at a provider, as its answer proves it: who signed in, and the tokens the code was
 * exchanged for.
 */
export type OAuthProviderSignIn = {
    /**
     * Who signed in, and when.
     */
    identity: FederatedProviderIdentity,
    /**
     * What the provider's token endpoint answered with.
     */
    tokens: TokenEndpointResponse
};