import { FederatedProfile } from './federated-profile.model';
import { ProviderAuthentication } from '../../models/provider-authentication.model';

/**
 * Who logged in at a provider, as its answer to a login proves.
 */
export type FederatedProviderIdentity = {
    /**
     * The issuer the provider's identities are known by.
     */
    issuer: string,
    /**
     * Who logged in, as the provider names them.
     */
    subject: string,
    /**
     * When they logged in at the provider.
     */
    authenticatedAt: Date,
    /**
     * What the provider reports about them.
     */
    profile: FederatedProfile,
    /**
     * Everything the provider proved about them: the claims of an OpenID Connect ID token, the
     * attributes of a SAML assertion, or what a provider that speaks plain OAuth2 answers about them.
     */
    claims: Record<string, unknown>,
    /**
     * How they proved who they are at the provider, when it says.
     */
    providerAuthentication: ProviderAuthentication | undefined
};